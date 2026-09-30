// Owner: D. Buyer onboarding: create buyer → payment limit (C's /buy/setup) → first standing order → link Telegram/MCP.
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { z } from "zod";
import { buyerIdForToken, newBuyerToken } from "../lib/tokens";
import { newId, requireApiKey, usd, type App } from "../lib/util";
import { isPlus } from "../payments";
import { cancelOrder, createOrder, listOrders } from "../orders";
// Grade caps from the optional form fields are folded into the rules text the LLM parser reads.
import type { Env, Grade } from "../types";
import { barcode, layout, receiptStyle, soonRail } from "./layout";

export const buy = new Hono<App>();

export async function createBuyer(
  env: Env,
  input: { name: string; email?: string; limitCents: number },
): Promise<{ buyerId: string; token: string }> {
  const buyerId = newId("b");
  const { token, hash } = await newBuyerToken();
  // Payment limit = the max they entered, valid 30 days. TODO(C): replace with SPT limits.
  const expires = new Date(Date.now() + 30 * 864e5).toISOString();
  await env.DB.prepare(
    "INSERT INTO buyers (id, name, email, token_hash, limit_cents, limit_expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(buyerId, input.name, input.email || null, hash, input.limitCents, expires).run();
  return { buyerId, token };
}

const titles = (env: Env) => env.DB.prepare("SELECT title FROM skus ORDER BY title").all<{ title: string }>();

type FormValues = { name?: string; email?: string; rules?: string; max?: string; capB?: string; capC?: string; capD?: string };


const buyForm = (catalog: string[], error?: string, v: FormValues = {}) => html`
  <p class="muted" style="font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase">Step 1 of 3 &middot; standing order &rarr; card &rarr; agent live</p>
  <h1>What are you hunting for?</h1>
  <p class="muted">Your agent bids for you in live auctions, never above your max.</p>
  ${error ? html`<div class="err">${error}</div>` : null}
  <div class="err" id="form-error" hidden></div>
  <form method="post" action="/buy" class="card" id="order-form">
    <h2>Standing order</h2>
    <label for="name">Name</label><input id="name" name="name" required maxlength="80" autocomplete="name" value="${v.name ?? ""}" />
    <label for="email">Email <span class="muted">(optional)</span></label><input id="email" name="email" type="email" maxlength="120" autocomplete="email" value="${v.email ?? ""}" />
    <label for="rules">What you want</label>
    <input id="rules" name="rules" required maxlength="430" placeholder="Pokemon Yellow, authentic, label in good shape" value="${v.rules ?? ""}" />
    <p class="muted" style="margin-top:4px">Free text — describe it your way, condition quirks and all. Off-catalog hunts get logged as unmet demand. (Suggestions below are shortcuts, not a menu.)</p>
    <div class="chips" id="chips">
      ${catalog.map((t) => html`<button type="button" class="chip">${t}</button>`)}
    </div>
    <label for="max">Max price (USD)</label><input id="max" name="max" type="number" min="1" max="1000" step="1" required value="${v.max ?? ""}" />
    <details style="margin-top: 20px">
      <summary style="cursor: pointer; font-family: var(--font-display); font-weight: 600; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted)">Grade caps &middot; optional</summary>
      <p class="muted">Bid less for rougher cartridges: cap what your agent pays at each grade. 0 means your agent never buys that grade.</p>
      <div class="row">
        <div style="flex: 1; min-width: 130px"><label for="capB">Max at grade B (USD)</label><input id="capB" name="capB" type="number" min="0" max="1000" step="1" value="${v.capB ?? ""}" /></div>
        <div style="flex: 1; min-width: 130px"><label for="capC">Max at grade C (USD)</label><input id="capC" name="capC" type="number" min="0" max="1000" step="1" value="${v.capC ?? ""}" /></div>
        <div style="flex: 1; min-width: 130px"><label for="capD">Max at grade D (USD)</label><input id="capD" name="capD" type="number" min="0" max="1000" step="1" value="${v.capD ?? ""}" /></div>
      </div>
    </details>
    <p class="muted">You pay the clearing price — never your max, usually less.</p>
    <p><button type="submit" class="primary">Save card and set order</button></p>
  </form>
  ${soonRail}
  <script>
    document.getElementById("chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const r = document.getElementById("rules");
      r.value = r.value ? r.value + ", " + chip.textContent : chip.textContent;
    });
    document.getElementById("order-form").addEventListener("submit", (e) => {
      const err = document.getElementById("form-error");
      const problems = [];
      const val = (id) => document.getElementById(id).value.trim();
      if (!val("name")) problems.push("Name is required.");
      if (val("rules").length < 3) problems.push("Describe what you want in a few words.");
      const max = Number(val("max"));
      if (!Number.isInteger(max) || max < 1 || max > 1000) problems.push("Max price must be a whole dollar amount between 1 and 1000.");
      for (const id of ["capB", "capC", "capD"]) {
        const cap = val(id);
        if (cap !== "" && (!Number.isInteger(Number(cap)) || Number(cap) < 0 || Number(cap) > 1000)) problems.push("Grade caps must be whole dollar amounts between 0 and 1000.");
      }
      if (problems.length) {
        e.preventDefault();
        err.textContent = problems.join(" ");
        err.hidden = false;
        err.scrollIntoView({ block: "center" });
        return;
      }
      const b = e.target.querySelector("button[type=submit]");
      b.disabled = true;
      b.textContent = "Setting up your agent…";
    });
  </script>`;

buy.get("/buy", async (c) => {
  const { results } = await titles(c.env);
  const catalog = results.map((s) => s.title);
  // Deep-link prefill: /buy?sku=pokemon+yellow&max=45 lands with the form filled.
  const pre = (c.req.query("sku") ?? "").slice(0, 120);
  const hit = pre ? catalog.find((t) => t.toLowerCase() === pre.toLowerCase()) ?? pre : "";
  const preMax = (c.req.query("max") ?? "").trim();
  const maxOk = /^\d{1,4}$/.test(preMax) && Number(preMax) >= 1 && Number(preMax) <= 1000 ? preMax : "";
  return c.html(layout("SnapFlip: set a standing order", buyForm(catalog, undefined, { ...(hit ? { rules: hit } : {}), ...(maxOk ? { max: maxOk } : {}) }), { image: `${c.env.PUBLIC_URL}/og.png` }));
});

// Optional per-grade caps: blank means "no cap for this grade", 0 means "never buy this grade".
const capField = z.union([z.literal(""), z.coerce.number().int().min(0).max(1000)]).optional();

const Form = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(120).optional().or(z.literal("")),
  // 430 + up to ~70 chars of appended grade-cap text stays under orders.ts' 500-char rulesText cap.
  rules: z.string().min(3).max(430),
  max: z.coerce.number().int().min(1).max(1000),
  capB: capField,
  capC: capField,
  capD: capField,
});

const NO_MATCH = "We couldn't match that to an item we're tracking — try one of the titles below.";

buy.post("/buy", async (c) => {
  const body = (await c.req.parseBody()) as Record<string, string>;
  const { results } = await titles(c.env);
  const catalog = results.map((s) => s.title);
  const render = (error: string) => c.html(layout("SnapFlip: set a standing order", buyForm(catalog, error, body)), 400);

  const parsed = Form.safeParse(body);
  if (!parsed.success) return render("Please fill in all fields.");
  const { name, email, rules, max, capB, capC, capD } = parsed.data;
  const limitCents = max * 100;
  const caps: string[] = [];
  for (const [gradeLetter, cap] of [["B", capB], ["C", capC], ["D", capD]] as const) {
    if (typeof cap === "number") caps.push(`pay at most $${cap} if grade ${gradeLetter}`);
  }
  const rulesText = caps.length ? `${rules} (${caps.join("; ")})` : rules;
  if (rulesText.length > 500) {
    return render("Grade caps push the description over the length limit - shorten 'What you want'.");
  }
  const { buyerId, token } = await createBuyer(c.env, { name, email, limitCents });
  try {
    await createOrder(c.env, { buyerId, rulesText, maxCents: limitCents });
  } catch (e) {
    await c.env.DB.prepare("DELETE FROM buyers WHERE id = ?").bind(buyerId).run();
    const msg = (e as Error).message;
    return render(msg.includes("could not match") ? NO_MATCH : msg);
  }
  setCookie(c, "sf_token", token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/buy",
    maxAge: 7 * 86400,
    secure: c.env.PUBLIC_URL.startsWith("https:"),
  });
  return c.redirect(`/buy/setup?buyer=${buyerId}`);
});



const capLine = (caps: Partial<Record<Grade, number>>) => {
  const parts = (Object.entries(caps) as [Grade, number][]).map(([g, c]) =>
    c === 0 ? `Grade ${g}: won't buy` : `Grade ${g}: up to ${usd(c)}`,
  );
  return parts.length ? html`<p class="muted">${parts.join(" · ")}</p>` : null;
};

buy.get("/buy/done", async (c) => {
  const buyerId = c.req.query("buyer") ?? "";
  const bot = c.env.TELEGRAM_BOT_USERNAME;
  const tokenBuyer = await buyerIdForToken(c.env, getCookie(c).sf_token);
  const own = tokenBuyer === buyerId;
  const connectorUrl = own ? `${c.env.PUBLIC_URL}/mcp?token=${getCookie(c).sf_token}` : null;

  let ordersCard = null;
  if (own) {
    const myOrders = await listOrders(c.env, buyerId);
    if (!myOrders.length) {
      ordersCard = html`<div class="card"><p class="muted">No standing orders on file. <a href="/buy">Set one.</a></p></div>`;
    } else {
      const skuIds = [...new Set(myOrders.flatMap((o) => o.rules.skuIds))];
      const titlesById = new Map<string, string>();
      if (skuIds.length) {
        const { results } = await c.env.DB.prepare(
          `SELECT id, title FROM skus WHERE id IN (${skuIds.map(() => "?").join(",")})`,
        ).bind(...skuIds).all<{ id: string; title: string }>();
        results.forEach((r) => titlesById.set(r.id, r.title));
      }
      ordersCard = html`<div class="receipt">
      <h2>SnapFlip · standing order</h2>
      <p class="muted" style="margin: 0">${myOrders[0].createdAt.slice(0, 10)} · ${buyerId}</p>
      ${myOrders.map(
        (o) => html`<div class="rule">
          <strong>${o.rulesText}</strong>
          <span class="muted"> — up to ${usd(o.maxCents)}${o.status === "open" ? "" : ` (${o.status})`}</span>
          <ul class="muted">${o.rules.skuIds.map((id) => html`<li>${titlesById.get(id) ?? id}</li>`)}</ul>
          ${capLine(o.rules.gradeCaps)}
        </div>`,
      )}
      ${barcode(myOrders[0].id)}
      <p class="thanks">Keep this receipt · agent armed</p>
    </div>`;
    }
  }

  return c.html(
    layout(
      "SnapFlip: you're in",
      html`${receiptStyle}
        <p class="muted" style="font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase">Step 3 of 3 &middot; agent live</p>
        <h1>Your agent is live.</h1>
        <p class="muted">It will bid the moment a matching item is snapped.</p>
        ${bot && own
          ? html`<p><a class="button" href="https://t.me/${bot}?start=${buyerId}">Get pinged on Telegram</a></p>`
          : html`<p class="muted">Buyer id: ${buyerId}</p>`}
        ${ordersCard}
        ${own ? html`<p class="muted"><a href="/buy/orders">View and manage your standing orders &rarr;</a></p>` : null}
        ${soonRail}
        ${connectorUrl
          ? html`<div class="card">
              <h2>Let Claude manage your orders</h2>
              <p class="muted">Paste this connector URL into Claude and it can browse the catalog, create and cancel your standing orders.</p>
              <p><input id="conn" readonly value="${connectorUrl}" onclick="this.select()" /></p>
              <p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('conn').value)">Copy URL</button></p>
              <ul class="muted">
                <li>Claude.ai: Settings &rarr; Connectors &rarr; Add custom connector &rarr; paste the URL.</li>
                <li>Claude Code: <code>claude mcp add --transport http snapflip "${connectorUrl}"</code></li>
              </ul>
              <p class="muted"><strong>This URL is a password.</strong> Anyone who has it can act as your buyer. Don't share it.</p>
            </div>`
          : null}
        <div class="card">
          <h2>Text the desk</h2>
          <p class="muted">Scout — our collector-desk agent — answers questions, reads you the live book, and can talk you through your next order: <a href="sms:+16503156536">+1 650 315 6536</a>.</p>
          <p class="muted">Run your own instead? Scout is a one-click install on the <a href="https://aiworthusing.com/agent-index/snapflip-scout">Agent Index</a> (OpenClaw, MIT) — it uses the same token above.</p>
        </div>`,
      { image: `${c.env.PUBLIC_URL}/og.png` },
    ),
  );
});

buy.get("/buy/orders", async (c) => {
  const buyerId = await buyerIdForToken(c.env, getCookie(c).sf_token);
  if (!buyerId) {
    return c.html(
      layout(
        "SnapFlip: your orders",
        html`<h1>Your standing orders</h1>
          <div class="card">
            <h2>No session</h2>
            <p class="muted">This browser holds no buyer session. <a href="/buy">Set a standing order</a> first; this page will then list it here.</p>
          </div>`,
      ),
    );
  }
  const mine = await listOrders(c.env, buyerId);
  const plus = await isPlus(c.env, buyerId);
  const plusCard = plus
    ? html`<div class="card"><h2>✦ Plus active</h2><p class="muted" style="margin:0">Your agents win the ties. <a href="/buy/plus?buyer=${buyerId}">Manage &rarr;</a></p></div>`
    : html`<div class="card"><h2>Go Plus — $6/mo</h2><p class="muted" style="margin:0 0 10px">Tie-break priority when maxes collide, plus the badge. <a class="button" href="/buy/plus?buyer=${buyerId}" style="margin-left:8px">Win the ties</a></p></div>`;
  // Win receipts: filled orders joined to their clearing auction — the "you paid
  // clearing, not max" proof. Best-effort; a missing join never breaks the page.
  let wins: { rulesText: string; maxCents: number; clearingCents: number; title: string; endedAt: string }[] = [];
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT o.rules_text AS rulesText, o.max_cents AS maxCents, a.clearing_cents AS clearingCents,
              COALESCE(sk.title, 'item') AS title, a.ended_at AS endedAt
         FROM orders o JOIN auctions a ON a.winner_order_id = o.id
         LEFT JOIN snaps sn ON sn.id = a.snap_id LEFT JOIN skus sk ON sk.id = sn.sku_id
        WHERE o.buyer_id = ? AND o.status = 'filled' AND a.clearing_cents IS NOT NULL
        ORDER BY a.ended_at DESC LIMIT 10`,
    ).bind(buyerId).all<{ rulesText: string; maxCents: number; clearingCents: number; title: string; endedAt: string }>();
    wins = results;
  } catch { /* pre-ledger or empty: no receipts */ }
  const receiptCard = (w: (typeof wins)[number]) => html`<div class="receipt">
    <h2>Won · ${w.title}</h2>
    <p class="muted" style="margin: 0">${w.endedAt.slice(0, 10)} · ${w.rulesText}</p>
    <div class="rule">
      <strong>Cleared ${usd(w.clearingCents)}</strong>
      <span class="muted"> — ${usd(w.maxCents - w.clearingCents)} under your ${usd(w.maxCents)} max</span>
    </div>
    <p class="thanks">You paid clearing, never max</p>
  </div>`;
  return c.html(
    layout(
      "SnapFlip: your orders",
      html`${receiptStyle}
        <h1>Your standing orders</h1>
        <p class="muted">Your agent bids in every matching auction, never above your max.</p>
        ${plusCard}
        ${wins.length ? html`<h2 style="margin-top:22px">Your wins</h2>${wins.map(receiptCard)}` : null}
        ${mine.length === 0
          ? html`<div class="card"><p class="muted">No orders yet. <a href="/buy">Set one now.</a></p></div>`
          : null}
        ${mine.map(
          (o) => html`<div class="card">
            <div class="row" style="justify-content: space-between">
              <div style="flex: 1; min-width: 240px">
                <span class="badge ${o.status === "open" ? "live" : o.status === "filled" ? "sold" : "off"}">${o.status}</span>
                <p style="margin: 10px 0 4px">${o.rulesText}</p>
                <p class="muted" style="margin: 0">Max ${usd(o.maxCents)} &middot; since ${o.createdAt.slice(0, 10)}</p>
                ${capLine(o.rules.gradeCaps)}
              </div>
              ${o.status === "open"
                ? html`<form method="post" action="/buy/orders/${o.id}/cancel" style="margin: 0">
                    <button type="submit" class="danger">Cancel order</button>
                  </form>`
                : null}
            </div>
          </div>`,
        )}
        <p class="muted"><a href="/buy">+ New standing order</a></p>`,
      { image: `${c.env.PUBLIC_URL}/og.png` },
    ),
  );
});

buy.post("/buy/orders/:id/cancel", async (c) => {
  const buyerId = await buyerIdForToken(c.env, getCookie(c).sf_token);
  if (!buyerId) return c.text("forbidden", 403);
  await cancelOrder(c.env, buyerId, c.req.param("id"));
  return c.redirect("/buy/orders");
});

const BuyerInput = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(120).optional(),
  limitCents: z.number().int().min(100).max(100_000),
});

// Brainbase concierge: creates a buyer and returns everything the concierge needs to hand back.
buy.post("/api/buyers", requireApiKey, async (c) => {
  const parsed = BuyerInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { buyerId, token } = await createBuyer(c.env, parsed.data);
  const bot = c.env.TELEGRAM_BOT_USERNAME;
  return c.json(
    {
      buyerId,
      token,
      mcpUrl: `${c.env.PUBLIC_URL}/mcp?token=${token}`,
      setupUrl: `${c.env.PUBLIC_URL}/buy/setup?buyer=${buyerId}`,
      ...(bot ? { telegramUrl: `https://t.me/${bot}?start=${buyerId}` } : {}),
    },
    201,
  );
});

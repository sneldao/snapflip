// Owner: D. Buyer onboarding: create buyer → payment limit (C's /buy/setup) → first standing order → link Telegram/MCP.
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { z } from "zod";
import { buyerIdForToken, newBuyerToken } from "../lib/tokens";
import { newId, requireApiKey, type App } from "../lib/util";
import { createOrder } from "../orders";
import type { Env } from "../types";
import { layout } from "./layout";

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

buy.get("/buy", async (c) => {
  const { results: skus } = await c.env.DB.prepare("SELECT title FROM skus ORDER BY title").all<{ title: string }>();
  return c.html(
    layout(
      "SnapFlip: set a standing order",
      html`<h1>What are you hunting for?</h1>
        <p class="muted">Your agent bids for you in live auctions, never above your max.</p>
        <form method="post" action="/buy" class="card">
          <label for="name">Name</label><input id="name" name="name" required maxlength="80" autocomplete="name" />
          <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" autocomplete="email" />
          <label for="rules">What you want</label>
          <input id="rules" name="rules" required maxlength="500" placeholder="Pokemon Yellow, authentic, label in good shape" />
          <p class="muted">We're matching: ${skus.map((s) => s.title).join(" · ")}</p>
          <label for="max">Max price (USD)</label><input id="max" name="max" type="number" min="1" max="1000" step="1" required />
          <p class="muted">You never pay more than your max. If your agent wins, you pay the price the auction stopped at, which is often less.</p>
          <p><button type="submit">Save card and set order</button></p>
        </form>`,
    ),
  );
});

const Form = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(120).optional().or(z.literal("")),
  rules: z.string().min(3).max(500),
  max: z.coerce.number().int().min(1).max(1000),
});

buy.post("/buy", async (c) => {
  const parsed = Form.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.text("Please fill in all fields.", 400);
  const { name, email, rules, max } = parsed.data;
  const limitCents = max * 100;
  const { buyerId, token } = await createBuyer(c.env, { name, email, limitCents });
  try {
    await createOrder(c.env, { buyerId, rulesText: rules, maxCents: limitCents });
  } catch (e) {
    return c.text(`Couldn't create that order: ${(e as Error).message}`, 400);
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

buy.get("/buy/done", async (c) => {
  const buyerId = c.req.query("buyer") ?? "";
  const bot = c.env.TELEGRAM_BOT_USERNAME;
  const tokenBuyer = await buyerIdForToken(c.env, getCookie(c).sf_token);
  const connectorUrl = tokenBuyer === buyerId ? `${c.env.PUBLIC_URL}/mcp?token=${getCookie(c).sf_token}` : null;
  return c.html(
    layout(
      "SnapFlip: you're in",
      html`<h1>Your agent is live.</h1>
        <p class="muted">It will bid the moment a matching item is snapped.</p>
        ${bot
          ? html`<p><a class="button" href="https://t.me/${bot}?start=${buyerId}">Get pinged on Telegram</a></p>`
          : html`<p class="muted">Buyer id: ${buyerId}</p>`}
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
          : null}`,
    ),
  );
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

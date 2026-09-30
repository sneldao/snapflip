// Owner: D. Price-watch onboarding — the desk's "want me to watch for one
// under $X?" lands here. Creates a pending watch, shows the current market
// reference, and hands off to Telegram for the ping. The page upsells the
// standing order: a watch watches, an order actually buys.
import { Hono } from "hono";
import { html } from "hono/html";
import { fetchAndCacheMarket, marketRefCents, readMarketCache } from "../market";
import { newId, usd, type App } from "../lib/util";
import { layout } from "./layout";

export const watch = new Hono<App>();

watch.get("/watch", async (c) => {
  const item = (c.req.query("item") ?? "").trim().replace(/\s+/g, " ");
  const maxDollars = parseFloat(c.req.query("max") ?? "");
  if (item.length < 2 || item.length > 140 || !isFinite(maxDollars) || maxDollars < 1 || maxDollars > 50000) {
    return c.html(
      layout(
        "SnapFlip: price watch",
        html`<h1>Set a price watch.</h1>
          <p class="err">That watch link is missing an item or a sane max. Ask the desk to make you a fresh one.</p>`,
      ),
      400,
    );
  }
  const maxCents = Math.round(maxDollars * 100);
  const query = item.toLowerCase();

  const id = newId("mw");
  const code = newId("w");
  await c.env.DB.prepare(
    "INSERT INTO market_watches (id, code, query, display, max_cents) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, code, query, item, maxCents).run();

  // Show the current tape alongside the target — likely cached from the desk's lookup.
  let ref: number | null = null;
  try {
    const payload = (await readMarketCache(c.env, query)) ?? (await fetchAndCacheMarket(c.env, query));
    ref = marketRefCents(payload);
  } catch { /* page still works without a live number */ }
  if (ref != null) {
    await c.env.DB.prepare("UPDATE market_watches SET ref_cents = ? WHERE id = ?").bind(ref, id).run();
  }

  const bot = c.env.TELEGRAM_BOT_USERNAME;
  const armed = ref != null && ref <= maxCents;
  return c.html(
    layout(
      `SnapFlip: watching ${item}`,
      html`
        <p class="muted" style="font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase">Price watch</p>
        <h1>Watching ${item}.</h1>
        <div class="card">
          <h2>market tape</h2>
          <p style="margin: 0"><span class="big">${ref != null ? usd(ref) : "—"}</span></p>
          <p class="muted" style="margin: 8px 0 0">
            ${ref != null
              ? armed
                ? `Already under your ${usd(maxCents)} max — the watch will ping you now.`
                : `Right now. Ping lands when the tape hits ${usd(maxCents)}.`
              : `No live number on this one yet — ping lands when the tape shows ${usd(maxCents)} or less.`}
          </p>
        </div>
        <p>
          ${bot
            ? html`<a class="button primary" href="https://t.me/${bot}?start=${code}">Ping me on Telegram</a>`
            : html`Telegram ping isn't configured on this deployment.`}
          <a class="button ghost" href="/buy?sku=${encodeURIComponent(item)}&max=${Math.round(maxCents / 100)}">Make it an order instead</a>
        </p>
        <p class="muted">A watch is a price ping, not a bid — nothing is ever bought or charged on a watch. A standing order is the version that actually grabs the next one a reseller snaps, under your max.</p>
      `,
    ),
  );
});

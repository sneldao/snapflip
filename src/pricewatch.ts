// Owner: D. Collector price watches — the desk's "want me to watch for one
// under $X?" made durable. Cron re-checks each armed watch against the market
// tape (index first, web comps off-catalog) and pings the collector's Telegram
// once when the reference price reaches their max. Fires once; a repeat watch
// is a new row.
import { fetchAndCacheMarket, marketRefCents, readMarketCache } from "./market";
import { esc, send } from "./telegram";
import { usd } from "./lib/util";
import type { Env } from "./types";

export async function checkMarketWatches(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, query, display, max_cents, tg_chat_id FROM market_watches WHERE status = 'armed' AND tg_chat_id IS NOT NULL",
  ).all<{ id: string; query: string; display: string; max_cents: number; tg_chat_id: string }>();

  for (const w of results) {
    try {
      const payload = (await readMarketCache(env, w.query)) ?? (await fetchAndCacheMarket(env, w.query));
      const ref = marketRefCents(payload);
      if (ref == null) continue;
      await env.DB.prepare("UPDATE market_watches SET ref_cents = ? WHERE id = ?").bind(ref, w.id).run();
      if (ref > w.max_cents) continue;

      await send(
        env,
        w.tg_chat_id,
        `<b>&gt; watch fired</b>\n${esc(w.display)} is at <b>${usd(ref)}</b> — under your ${usd(w.max_cents)} max.\n\n` +
          `A ping is a price, not a bid. To actually grab the next one that surfaces: set a standing order and a reseller's snap sells to you on the rack.`,
        [[{ text: "Set a standing order", url: `${env.PUBLIC_URL}/buy?sku=${encodeURIComponent(w.display)}&max=${Math.round(w.max_cents / 100)}` }]],
      );
      await env.DB.prepare(
        "UPDATE market_watches SET status = 'fired', fired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      )
        .bind(w.id)
        .run();
    } catch (e) {
      console.error("market watch check failed", w.id, e);
    }
  }
}

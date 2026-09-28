// Owner: A. Seller "ping me" watches — remembered demand signals for finds nobody wanted yet.
import { newId } from "./lib/util";
import { normTitle, ordinal, seriesTokens, titleCovers } from "./lib/titles";
import { esc, send } from "./telegram";
import type { Env } from "./types";

export { normTitle, ordinal, seriesTokens, titleCovers };

interface DemandRow {
  id: string;
  title: string;
  buyer_id: string;
}

/**
 * Real open demand for something related to what the seller snapped — same game series,
 * different catalogue entry. Returns null when there's genuinely nothing nearby.
 */
export async function nearbyDemand(env: Env, title: string, excludeSkuId?: string): Promise<{ collectors: number; titles: string[] } | null> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.title, o.buyer_id FROM orders o JOIN order_skus os ON os.order_id = o.id JOIN skus s ON s.id = os.sku_id
      WHERE o.status = 'open' AND o.buyer_id NOT LIKE 'b_demo_%'`,
  ).all<DemandRow>();
  const tokens = new Set(seriesTokens(title));
  if (!tokens.size) return null;
  const perSku = new Map<string, { title: string; buyers: Set<string> }>();
  for (const r of results) {
    if (r.id === excludeSkuId) continue;
    if (!seriesTokens(r.title).some((t) => tokens.has(t))) continue;
    let e = perSku.get(r.id);
    if (!e) perSku.set(r.id, (e = { title: r.title, buyers: new Set() }));
    e.buyers.add(r.buyer_id);
  }
  const collectors = new Set([...perSku.values()].flatMap((e) => [...e.buyers])).size;
  if (!collectors) return null;
  const titles = [...new Set([...perSku.values()].sort((a, b) => b.buyers.size - a.buyers.size).map((e) => e.title))].slice(0, 2);
  return { collectors, titles };
}

export async function snapsToday(env: Env, sellerId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM snaps WHERE seller_id = ? AND created_at >= date('now')")
    .bind(sellerId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Record an offered watch (active=0). The seller's button tap flips it to 1. */
export async function offerWatch(
  env: Env,
  w: { sellerId: string; snapId: string; skuId: string | null; title: string },
): Promise<string> {
  const id = newId("w");
  await env.DB.prepare("INSERT INTO watches (id, seller_id, snap_id, sku_id, title, active) VALUES (?, ?, ?, ?, ?, 0)")
    .bind(id, w.sellerId, w.snapId, w.skuId, w.title)
    .run();
  return id;
}

/**
 * Called after a real (non-demo) order is created: ping each armed, unnotified seller
 * whose watch matches one of the order's SKUs. One ping per watch — notified_at is the latch.
 */
export async function pingWatchers(env: Env, order: { buyerId: string; skuIds: string[] }): Promise<void> {
  if (order.buyerId.startsWith("b_demo_")) return;
  if (!order.skuIds.length) return;
  const { results: skuRows } = await env.DB.prepare(
    `SELECT id, title FROM skus WHERE id IN (${order.skuIds.map(() => "?").join(",")})`,
  ).bind(...order.skuIds).all<{ id: string; title: string }>();
  const skuTitles = new Map(skuRows.map((r) => [r.id, r.title]));
  const { results: open } = await env.DB.prepare(
    "SELECT id, seller_id, sku_id, title FROM watches WHERE active = 1 AND notified_at IS NULL",
  ).all<{ id: string; seller_id: string; sku_id: string | null; title: string }>();
  const pinged = new Set<string>(); // seller|title — one ping per seller per matched cart
  for (const w of open) {
    let matched: string | undefined;
    if (w.sku_id) {
      matched = skuTitles.get(w.sku_id);
    } else {
      for (const t of skuTitles.values()) {
        if (titleCovers(w.title, t)) { matched = t; break; }
      }
    }
    if (!matched) continue;
    const seller = await env.DB.prepare("SELECT tg_chat_id FROM sellers WHERE id = ?")
      .bind(w.seller_id)
      .first<{ tg_chat_id: string | null }>();
    if (seller?.tg_chat_id) {
      const key = `${w.seller_id}|${matched}`;
      if (!pinged.has(key)) await send(
        env,
        seller.tg_chat_id,
        `<code>WANTED</code> · ${esc(matched)}\nA collector just set a standing order for a cart you snapped.\n▸ Still on the rack? Snap it again to open an auction.`,
      );
      pinged.add(key);
      await env.DB.prepare("UPDATE watches SET notified_at = ? WHERE id = ?").bind(new Date().toISOString(), w.id).run();
    }
  }
}

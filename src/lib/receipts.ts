// Owner: E. Hash-chained receipt log over the bids table. Each event's hash commits to
// the previous one, so the chain head is a single anchor for the whole auction record —
// the thing week 3 writes on-chain (docs/CONCORDIUM.md §7). Refusals are in the chain
// too: the audit trail covers who was kept out, not just who won.
import type { BidEvent, Env } from "../types";

export const RECEIPT_GENESIS = "0".repeat(64);

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Positional array, not object keys: the encoding must be byte-stable forever.
const canonical = (e: BidEvent) => JSON.stringify([e.orderId, e.event, e.priceCents, e.reason ?? null, e.at]);

export interface ReceiptLink {
  event: BidEvent;
  hash: string;
}

/** Chain a sequence of bid events. Order matters — callers pass insertion order. */
export async function chainEvents(events: BidEvent[]): Promise<ReceiptLink[]> {
  let prev = RECEIPT_GENESIS;
  const out: ReceiptLink[] = [];
  for (const event of events) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prev + canonical(event)));
    prev = toHex(digest);
    out.push({ event, hash: prev });
  }
  return out;
}

/** An auction's full receipt chain plus its head hash (the anchor value) and, when the
 *  winner paid through the x402 rail, the settlement record tying the payment to it. */
export async function auctionReceipts(
  env: Pick<Env, "DB">,
  auctionId: string,
): Promise<{
  head: string | null;
  events: ReceiptLink[];
  settlement: { payer: string | null; at: string; rail: string; txHash: string | null } | null;
}> {
  const { results } = await env.DB.prepare(
    "SELECT order_id, event, price_cents, reason, at FROM bids WHERE auction_id = ? ORDER BY rowid",
  )
    .bind(auctionId)
    .all<{ order_id: string; event: BidEvent["event"]; price_cents: number; reason: string | null; at: string }>();
  const events: BidEvent[] = results.map((r) => ({
    orderId: r.order_id,
    event: r.event,
    priceCents: r.price_cents,
    reason: r.reason ?? undefined,
    at: r.at,
  }));
  const chain = await chainEvents(events);
  const x = await env.DB.prepare(
    `SELECT s.payer, s.at, a.payment_rail, a.settle_tx_hash
       FROM x402_settlements s JOIN auctions a ON a.id = s.auction_id WHERE s.auction_id = ?`,
  )
    .bind(auctionId)
    .first<{ payer: string | null; at: string; payment_rail: string | null; settle_tx_hash: string | null }>()
    .catch(() => null);
  return {
    head: chain.length ? chain[chain.length - 1].hash : null,
    events: chain,
    settlement: x ? { payer: x.payer, at: x.at, rail: x.payment_rail ?? "x402", txHash: x.settle_tx_hash } : null,
  };
}

// Owner: C. Single source of truth for the seller take rate.
// All money in integer cents. The bps rate is snapshotted into platform_fees at settle
// time, so later SELLER_FEE_BPS changes never rewrite history. Every call site — the
// auction engine, payouts, and views — must go through here, never inline bps math.

/** 10%: the take rate when SELLER_FEE_BPS is unset or invalid. */
export const DEFAULT_FEE_BPS = 1000;

/** $6/mo Buyer Plus. Must match the Stripe Price pointed at by BUYER_PLUS_PRICE_ID. */
export const PLUS_MONTHLY_CENTS = 600;

/** 1%: the rush fee for express seller payout when EXPRESS_FEE_BPS is unset or invalid. */
export const DEFAULT_EXPRESS_FEE_BPS = 100;

/** Parse and clamp the configured take rate. Never throws, never returns NaN. */
export function sellerFeeBps(env: { SELLER_FEE_BPS?: string }): number {
  const raw = (env.SELLER_FEE_BPS ?? "").trim();
  if (!raw) return DEFAULT_FEE_BPS;
  const bps = Number(raw);
  return Number.isFinite(bps) && bps >= 0 && bps <= 10_000 ? bps : DEFAULT_FEE_BPS;
}

/** Parse and clamp the express-payout rush fee. Same safety contract as sellerFeeBps. */
export function expressFeeBps(env: { EXPRESS_FEE_BPS?: string }): number {
  const raw = (env.EXPRESS_FEE_BPS ?? "").trim();
  if (!raw) return DEFAULT_EXPRESS_FEE_BPS;
  const bps = Number(raw);
  return Number.isFinite(bps) && bps >= 0 && bps <= 10_000 ? bps : DEFAULT_EXPRESS_FEE_BPS;
}

/** Split a clearing price into the platform fee and the seller net. Rounds half up. */
export function splitFee(clearingCents: number, feeBps: number): { feeCents: number; netCents: number } {
  const feeCents = Math.round((clearingCents * feeBps) / 10_000);
  return { feeCents, netCents: clearingCents - feeCents };
}

/** Carve a rush fee out of the seller net for express payout. */
export function splitExpress(netCents: number, expressBps: number): { expressFeeCents: number; payoutCents: number } {
  const expressFeeCents = Math.round((netCents * expressBps) / 10_000);
  return { expressFeeCents, payoutCents: netCents - expressFeeCents };
}

/** Build the platform_fees ledger row for a settled auction. Pure so the money math
 *  is unit-testable; persistAndSettle writes exactly what this returns. */
export function feeLedgerRow(auctionId: string, clearingCents: number, feeBps: number): {
  auction_id: string; clearing_cents: number; fee_bps: number; fee_cents: number;
} {
  return { auction_id: auctionId, clearing_cents: clearingCents, fee_bps: feeBps, fee_cents: splitFee(clearingCents, feeBps).feeCents };
}

/** "1000" → "10%". For human-facing fee labels. */
export function feePct(feeBps: number): string {
  return `${feeBps / 100}%`;
}

/** Ledger DDL. Duplicated in schema.sql; the engine ensures it at settle time so
 *  databases created before the ledger existed keep working without a migration. */
export const PLATFORM_FEES_DDL = `CREATE TABLE IF NOT EXISTS platform_fees (
  auction_id TEXT PRIMARY KEY REFERENCES auctions(id),
  clearing_cents INTEGER NOT NULL,
  fee_bps INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

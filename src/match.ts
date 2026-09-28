// Owner: B. Find standing orders that match a snap and compute each agent's private dropout price.
import type { Env, Grade, MatchJob, OrderRules, Snap, Valuation } from "./types";

/**
 * Pure, deterministic valuation from structured rules. Claude can add nuance on top
 * (TODO(B): Claude verifies "same SKU?" and explains), but money caps are always enforced here.
 */
export function valueForOrder(
  input: { orderId: string; buyerId: string; rules: OrderRules; maxCents: number; buyerLimitCents: number },
  snap: Pick<Snap, "skuId" | "grade" | "flags">,
): Valuation {
  const { orderId, buyerId, rules } = input;
  const limitCents = Math.min(input.maxCents, input.buyerLimitCents);
  const no = (reason: string): Valuation => ({ orderId, buyerId, eligible: false, dropoutCents: 0, limitCents, reason });

  if (!snap.skuId || !rules.skuIds.includes(snap.skuId)) return no("different item");
  const rejected = snap.flags.find((f) => rules.reject.includes(f));
  if (rejected) return no(`rejected: ${rejected}`);
  const missing = rules.require.find((r) => !snap.flags.includes(r));
  if (missing) return no(`missing requirement: ${missing}`);

  const cap = rules.gradeCaps[snap.grade as Grade];
  const gradeCap = cap === undefined ? input.maxCents : cap;
  if (gradeCap <= 0) return no(`grade ${snap.grade} not accepted`);

  const dropoutCents = Math.min(gradeCap, limitCents);
  const reason =
    dropoutCents < input.maxCents
      ? `grade ${snap.grade}, capped at $${(dropoutCents / 100).toFixed(0)}`
      : `max $${(dropoutCents / 100).toFixed(0)}`;
  return { orderId, buyerId, eligible: dropoutCents > 0, dropoutCents, limitCents, reason };
}

export async function findCandidates(env: Env, snap: Snap): Promise<Valuation[]> {
  if (!snap.skuId) return [];
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.buyer_id, o.rules_json, o.max_cents, b.limit_cents
       FROM order_skus os
       JOIN orders o ON o.id = os.order_id
       JOIN buyers b ON b.id = o.buyer_id
      WHERE os.sku_id = ? AND o.status = 'open'
        AND (o.expires_at IS NULL OR o.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY o.created_at`,
  )
    .bind(snap.skuId)
    .all<{ id: string; buyer_id: string; rules_json: string; max_cents: number; limit_cents: number }>();

  return results.map((r) =>
    valueForOrder(
      { orderId: r.id, buyerId: r.buyer_id, rules: JSON.parse(r.rules_json), maxCents: r.max_cents, buyerLimitCents: r.limit_cents },
      snap,
    ),
  );
}

/** Queue consumer. TODO(B): move per-order Claude verification here when there are >5 candidates. */
export async function handleMatchBatch(batch: MessageBatch<MatchJob>, _env: Env): Promise<void> {
  for (const msg of batch.messages) {
    console.log("match job", msg.body.snapId);
    msg.ack();
  }
}

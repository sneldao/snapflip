// Owner: B. Find standing orders that match a snap and compute each agent's private dropout price.
import { claudeJson, llmAvailable } from "./lib/claude";
import type { Env, Grade, MatchJob, OrderRules, Snap, Valuation } from "./types";

/**
 * Pure, deterministic valuation from structured rules — the source of truth for money and
 * eligibility. verifyOne() layers Claude's judgement on top (veto + plain-English reason),
 * but the dropout computed here is the hard ceiling that caps whatever the model returns.
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

/**
 * Claude double-checks a code-eligible match and explains the walk-away price in plain English.
 * It can only VETO the match or LOWER the price — the code-computed dropout is the hard ceiling,
 * so a bad model response can never over-spend. Falls back to the deterministic result on failure.
 */
interface Verdict {
  eligible: boolean;
  dropoutCents?: number;
  reason?: string;
}

async function verifyOne(env: Env, snap: Snap, det: Valuation, rulesText: string): Promise<Valuation> {
  try {
    const v = await claudeJson<Verdict>(env, {
      maxTokens: 300,
      system: `You are a collector's purchasing agent. Decide whether a specific second-hand item matches your buyer's standing order and what it is worth to them.

Buyer's order (plain English): "${rulesText}"

The item the seller is holding:
- title: ${snap.title}
- condition grade: ${snap.grade} (A = near mint, B = light wear, C = heavy wear/label damage, D = damaged or incomplete)
- grader's notes: ${snap.gradeNotes || "none"}
- condition flags: ${snap.flags.length ? snap.flags.join(", ") : "none"}

Your code has already set the HARD maximum this buyer will pay for THIS item at ${det.dropoutCents} cents. You may lower it if the condition warrants, but never exceed it.

Return {"eligible": boolean, "dropoutCents": integer (<= ${det.dropoutCents}), "reason": one short sentence the buyer will read}.`,
      content: [{ type: "text", text: "Does this item match the order, and what is your walk-away price?" }],
    });
    const dropoutCents = Math.max(0, Math.min(det.dropoutCents, Math.round(v.dropoutCents ?? det.dropoutCents)));
    const eligible = det.eligible && v.eligible !== false && dropoutCents > 0;
    return { ...det, eligible, dropoutCents, reason: v.reason?.trim().slice(0, 140) || det.reason };
  } catch (e) {
    console.error("match verify failed, using deterministic:", (e as Error).message);
    return det;
  }
}

// Max simultaneous verifyOne calls — bounds outbound model-call bursts per snap.
const VERIFY_CONCURRENCY = 5;

export async function findCandidates(env: Env, snap: Snap): Promise<Valuation[]> {
  if (!snap.skuId) return [];
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.buyer_id, o.rules_json, o.rules_text, o.max_cents, b.limit_cents
       FROM order_skus os
       JOIN orders o ON o.id = os.order_id
       JOIN buyers b ON b.id = o.buyer_id
      WHERE os.sku_id = ? AND o.status = 'open'
        AND (o.expires_at IS NULL OR o.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY o.created_at`,
  )
    .bind(snap.skuId)
    .all<{ id: string; buyer_id: string; rules_json: string; rules_text: string; max_cents: number; limit_cents: number }>();

  // Buyer Plus perk: Plus agents lead the field, so on equal dropoutCents the auction's
  // earliest-wins tie-break favors them (and they take the low Agent numbers). Best-effort:
  // a missing subscriptions table must never break matching.
  let plusBuyers = new Set<string>();
  try {
    const { results: subs } = await env.DB.prepare(
      `SELECT buyer_id FROM subscriptions WHERE status IN ('active', 'trialing')
        AND (current_period_end IS NULL OR current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).all<{ buyer_id: string }>();
    plusBuyers = new Set(subs.map((r) => r.buyer_id));
  } catch { /* pre-Plus database: nobody is Plus */ }

  const deterministic = results.map((r) => ({
    val: valueForOrder(
      { orderId: r.id, buyerId: r.buyer_id, rules: JSON.parse(r.rules_json), maxCents: r.max_cents, buyerLimitCents: r.limit_cents },
      snap,
    ),
    rulesText: r.rules_text,
  }));
  // Stable partition: eligible Plus orders first, everything else keeps created_at order.
  deterministic.sort((a, b) =>
    Number(b.val.eligible && plusBuyers.has(b.val.buyerId)) - Number(a.val.eligible && plusBuyers.has(a.val.buyerId)),
  );

  // Deterministic result is the source of truth for money. Claude only refines eligible matches.
  if (!llmAvailable(env)) return deterministic.map((d) => d.val);

  // Chunked fan-out: N standing orders on a hot SKU must not fire N concurrent model
  // calls at a provider. Ineligible orders pass through untouched, order is preserved.
  const verified = new Map<string, Valuation>();
  const pending = deterministic.filter((d) => d.val.eligible);
  for (let i = 0; i < pending.length; i += VERIFY_CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + VERIFY_CONCURRENCY).map(async (d) =>
        verified.set(d.val.orderId, await verifyOne(env, snap, d.val, d.rulesText)),
      ),
    );
  }
  return deterministic.map((d) => verified.get(d.val.orderId) ?? d.val);
}

/** Queue consumer. Unused — verify fan-out is bounded by VERIFY_CONCURRENCY instead. */
export async function handleMatchBatch(batch: MessageBatch<MatchJob>, _env: Env): Promise<void> {
  for (const msg of batch.messages) {
    console.log("match job", msg.body.snapId);
    msg.ack();
  }
}

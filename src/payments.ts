// Owner: C. Payment limits, authorize/capture, Connect payouts.
// Stub mode: with no STRIPE_SECRET_KEY, every call succeeds with fake ids so A/B/D can test the full loop.
import { Hono } from "hono";
import { html } from "hono/html";
import Stripe from "stripe";
import { notify } from "./telegram";
import { requireApiKey, type App } from "./lib/util";
import { expressFeeBps, PLUS_MONTHLY_CENTS, sellerFeeBps, splitExpress, splitFee } from "./lib/fees";
import { layout } from "./web/layout";
import type { Env, RankedBid, SettleResult } from "./types";

export function stripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

const stubMode = (env: Env) => !env.STRIPE_SECRET_KEY;

/** DDL mirror of schema.sql — ensures the table on DBs created before it existed. */
const SUBSCRIPTIONS_DDL = `CREATE TABLE IF NOT EXISTS subscriptions (
  buyer_id TEXT PRIMARY KEY REFERENCES buyers(id),
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

/** Buyer Plus entitlement. False on any error — a missing table must never break matching. */
export async function isPlus(env: Env, buyerId: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM subscriptions WHERE buyer_id = ? AND status IN ('active', 'trialing')
        AND (current_period_end IS NULL OR current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).bind(buyerId).first<{ ok: number }>();
    return !!row;
  } catch {
    return false;
  }
}

/** Trusted sellers (flawless reliability + connected Stripe account) may skip the delivery hold. */
export async function expressEligible(env: Env, sellerId: string): Promise<boolean> {
  const s = await env.DB.prepare("SELECT stripe_account_id, reliability FROM sellers WHERE id = ?")
    .bind(sellerId).first<{ stripe_account_id: string | null; reliability: number }>();
  return !!s?.stripe_account_id && s.reliability >= 1.0;
}

/** Seller gets 2h to confirm purchase before the card hold is released. */
const AUTH_HOLD_MS = 2 * 60 * 60 * 1000;

type AuctionRow = {
  id: string; status: string; clearing_cents: number | null; payment_intent_id: string | null;
  winner_order_id: string | null; seller_id: string; stripe_account_id: string | null;
  buyer_id: string | null; title: string;
};

async function loadAuction(env: Env, auctionId: string): Promise<AuctionRow | null> {
  return env.DB.prepare(
    `SELECT a.id, a.status, a.clearing_cents, a.payment_intent_id, a.winner_order_id,
            sn.seller_id, se.stripe_account_id, o.buyer_id,
            COALESCE(sk.title, 'item') AS title
       FROM auctions a JOIN snaps sn ON sn.id = a.snap_id JOIN sellers se ON se.id = sn.seller_id
       LEFT JOIN orders o ON o.id = a.winner_order_id LEFT JOIN skus sk ON sk.id = sn.sku_id
      WHERE a.id = ?`,
  ).bind(auctionId).first<AuctionRow>();
}

/**
 * HANDOFF B → C. Authorize (manual capture) the first bidder whose card works.
 * Enforces the buyer's payment limit here, independently of the auction engine.
 */
export async function settleAuction(env: Env, auctionId: string, ranked: RankedBid[]): Promise<SettleResult> {
  for (const bid of ranked) {
    const buyer = await env.DB.prepare(
      `SELECT b.id, b.stripe_customer_id, b.payment_method_id, b.limit_cents, b.limit_expires_at
         FROM orders o JOIN buyers b ON b.id = o.buyer_id WHERE o.id = ?`,
    ).bind(bid.orderId).first<{ id: string; stripe_customer_id: string | null; payment_method_id: string | null; limit_cents: number; limit_expires_at: string | null }>();
    if (!buyer || bid.priceCents > buyer.limit_cents) continue;
    if (buyer.limit_expires_at && buyer.limit_expires_at < new Date().toISOString()) continue;

    if (stubMode(env)) return { ok: true, orderId: bid.orderId, paymentIntentId: `pi_stub_${auctionId}`, priceCents: bid.priceCents };
    if (!buyer.stripe_customer_id || !buyer.payment_method_id) continue;

    try {
      // TODO(C): try Shared Payment Token first when buyer.spt_id is set.
      const pi = await stripe(env).paymentIntents.create(
        {
          amount: bid.priceCents,
          currency: "usd",
          customer: buyer.stripe_customer_id,
          payment_method: buyer.payment_method_id,
          capture_method: "manual",
          off_session: true,
          confirm: true,
          transfer_group: `auction_${auctionId}`,
          metadata: { auctionId, orderId: bid.orderId },
        },
        { idempotencyKey: `settle_${auctionId}_${bid.orderId}` },
      );
      if (pi.status === "requires_capture") return { ok: true, orderId: bid.orderId, paymentIntentId: pi.id, priceCents: bid.priceCents };
    } catch (e) {
      console.error("authorize failed, trying next bidder", bid.orderId, (e as Error).message);
    }
  }
  return { ok: false, reason: "no bidder could be charged" };
}

/** HANDOFF A → C. Seller confirmed they bought the item: capture the authorized payment. */
export async function capture(env: Env, auctionId: string): Promise<void> {
  const a = await loadAuction(env, auctionId);
  if (!a || a.status !== "settled" || !a.payment_intent_id) throw new Error("auction not capturable");
  if (!stubMode(env)) await stripe(env).paymentIntents.capture(a.payment_intent_id, {}, { idempotencyKey: `capture_${auctionId}` });
  await env.DB.prepare("UPDATE auctions SET status = 'captured' WHERE id = ?").bind(auctionId).run();
  if (a.buyer_id) {
    await notify(env, { buyerId: a.buyer_id }, { type: "captured", auctionId, title: a.title, priceCents: a.clearing_cents ?? 0 });
  }
}

/**
 * Express payout: trusted sellers cash out at confirm time instead of waiting for delivery,
 * for a rush fee on top of the standard take. Express failure never breaks the sale — the
 * auction stays 'captured' and the standard on-delivery payout still applies.
 */
export async function releaseExpress(env: Env, auctionId: string): Promise<{ payoutCents: number; expressFeeCents: number }> {
  const a = await loadAuction(env, auctionId);
  if (!a || a.status !== "captured" || a.clearing_cents == null) throw new Error("auction not releasable");
  if (!(await expressEligible(env, a.seller_id))) throw new Error("express unlocks after reliable deliveries");
  const { netCents } = splitFee(a.clearing_cents, sellerFeeBps(env));
  const { expressFeeCents, payoutCents } = splitExpress(netCents, expressFeeBps(env));
  let transferId = `tr_stub_${auctionId}`;
  if (!stubMode(env)) {
    if (!a.stripe_account_id) throw new Error("seller has no Connect account");
    const s = stripe(env);
    let sourceTransaction: string | undefined;
    if (a.payment_intent_id) {
      const pi = await s.paymentIntents.retrieve(a.payment_intent_id);
      sourceTransaction = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? undefined);
    }
    const t = await s.transfers.create(
      {
        amount: payoutCents,
        currency: "usd",
        destination: a.stripe_account_id,
        transfer_group: `auction_${auctionId}`,
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      },
      { idempotencyKey: `release_express_${auctionId}` },
    );
    transferId = t.id;
  }
  await env.DB.prepare("UPDATE auctions SET status = 'released', transfer_id = ? WHERE id = ?").bind(transferId, auctionId).run();
  // Best-effort: pre-ledger databases have no platform_fees table yet.
  await env.DB.prepare("UPDATE platform_fees SET express_fee_cents = ? WHERE auction_id = ?").bind(expressFeeCents, auctionId).run().catch(() => {});
  await notify(env, { sellerId: a.seller_id }, { type: "released", auctionId, amountCents: payoutCents });
  return { payoutCents, expressFeeCents };
}

/** HANDOFF A → C. Delivered: transfer clearing price minus fee to the seller's Connect account. */
export async function release(env: Env, auctionId: string): Promise<void> {
  const a = await loadAuction(env, auctionId);
  if (!a || a.status !== "captured" || a.clearing_cents == null) throw new Error("auction not releasable");
  // Prefer the fee snapshot written at settle time; fall back to the live rate for
  // auctions that settled before the ledger existed.
  const snap = await env.DB.prepare("SELECT fee_cents FROM platform_fees WHERE auction_id = ?")
    .bind(auctionId).first<{ fee_cents: number }>().catch(() => null);
  const amount = snap
    ? a.clearing_cents - snap.fee_cents
    : splitFee(a.clearing_cents, sellerFeeBps(env)).netCents;
  let transferId = `tr_stub_${auctionId}`;
  if (!stubMode(env)) {
    if (!a.stripe_account_id) throw new Error("seller has no Connect account");
    const s = stripe(env);
    // Tie the transfer to the original charge so it succeeds even before the platform balance
    // settles, and links the payout to the payment for reporting.
    let sourceTransaction: string | undefined;
    if (a.payment_intent_id) {
      const pi = await s.paymentIntents.retrieve(a.payment_intent_id);
      sourceTransaction = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? undefined);
    }
    // TODO(C): subtract shipping label cost once labels exist.
    const t = await s.transfers.create(
      {
        amount,
        currency: "usd",
        destination: a.stripe_account_id,
        transfer_group: `auction_${auctionId}`,
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      },
      { idempotencyKey: `release_${auctionId}` },
    );
    transferId = t.id;
  }
  await env.DB.prepare("UPDATE auctions SET status = 'released', transfer_id = ? WHERE id = ?").bind(transferId, auctionId).run();
  await notify(env, { sellerId: a.seller_id }, { type: "released", auctionId, amountCents: amount });
}

/**
 * Void an authorization that never got a seller confirm: cancel the PaymentIntent (frees the
 * card hold), reopen the winning order so it can bid again, and lower the seller's reliability.
 */
export async function voidAuthorization(env: Env, auctionId: string): Promise<void> {
  const a = await loadAuction(env, auctionId);
  if (!a || a.status !== "settled" || !a.payment_intent_id) throw new Error("auction not voidable");
  if (!stubMode(env)) await stripe(env).paymentIntents.cancel(a.payment_intent_id, {}, { idempotencyKey: `void_${auctionId}` });
  await env.DB.batch([
    env.DB.prepare("UPDATE auctions SET status = 'expired' WHERE id = ?").bind(auctionId),
    env.DB.prepare("UPDATE orders SET status = 'open' WHERE id = ? AND status = 'filled'").bind(a.winner_order_id ?? ""),
    env.DB.prepare("UPDATE sellers SET reliability = MAX(0.0, reliability - 0.2) WHERE id = ?").bind(a.seller_id),
  ]);
  await notify(env, { sellerId: a.seller_id }, { type: "no_sale", auctionId, title: a.title });
}

/** Dispute / not-as-described: refund the captured payment. Only valid before the payout transfer. */
export async function refund(env: Env, auctionId: string): Promise<void> {
  const a = await loadAuction(env, auctionId);
  if (!a || a.status !== "captured" || !a.payment_intent_id) throw new Error("auction not refundable");
  if (!stubMode(env)) await stripe(env).refunds.create({ payment_intent: a.payment_intent_id }, { idempotencyKey: `refund_${auctionId}` });
  await env.DB.prepare("UPDATE auctions SET status = 'refunded' WHERE id = ?").bind(auctionId).run();
}

/** Cron sweep: void auths where the seller never confirmed within the hold window. */
export async function voidExpiredAuths(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - AUTH_HOLD_MS).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id FROM auctions WHERE status = 'settled' AND COALESCE(ended_at, started_at) < ?",
  ).bind(cutoff).all<{ id: string }>();
  for (const { id } of results) {
    try {
      await voidAuthorization(env, id);
    } catch (e) {
      console.error("voidExpiredAuths failed", id, (e as Error).message);
    }
  }
}

export const payments = new Hono<App>();

/** Reuse the buyer's Stripe customer across card setup and Plus checkout. */
async function ensureCustomer(env: Env, buyer: { id: string; name: string; email: string | null; stripe_customer_id: string | null }): Promise<string> {
  if (buyer.stripe_customer_id) return buyer.stripe_customer_id;
  const customer = (await stripe(env).customers.create({ name: buyer.name, email: buyer.email ?? undefined, metadata: { buyerId: buyer.id } })).id;
  await env.DB.prepare("UPDATE buyers SET stripe_customer_id = ? WHERE id = ?").bind(customer, buyer.id).run();
  return customer;
}

/** Buyer Plus perks page. No side effects — checkout is a separate step. */
payments.get("/buy/plus", async (c) => {
  const buyerId = c.req.query("buyer") ?? "";
  const buyer = buyerId
    ? await c.env.DB.prepare("SELECT id FROM buyers WHERE id = ?").bind(buyerId).first<{ id: string }>()
    : null;
  if (!buyer) return c.text("unknown buyer", 404);
  const plus = await isPlus(c.env, buyerId);
  return c.html(
    layout(
      "SnapFlip Plus",
      html`<p class="muted" style="font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase">Buyer Plus &middot; $6/mo &middot; cancel anytime</p>
        <h1>Win the ties.</h1>
        ${plus
          ? html`<div class="card"><h2>✦ Plus active</h2><p class="muted" style="margin:0">Your agents jump the tie-breaks. <a href="/buy/orders">Back to your orders &rarr;</a></p></div>`
          : html`<div class="card">
              <h2>What Plus gets you</h2>
              <ul>
                <li><strong>Tie-break priority.</strong> Equal max? Your agent wins and takes the better number.</li>
                <li><strong>Plus badge</strong> on your orders — sellers see real demand.</li>
                <li><strong>Funds the book.</strong> Keeps collector seats free for everyone else.</li>
              </ul>
              <p><a class="button" href="/buy/plus/checkout?buyer=${buyerId}">Go Plus — $6/mo</a></p>
              <p class="muted">One subscription per buyer. Cancel anytime from your receipt page.</p>
            </div>`}`,
      { image: `${c.env.PUBLIC_URL}/og.png` },
    ),
  );
});

/** Start Plus checkout. Stub mode activates instantly so the demo works with no keys. */
payments.get("/buy/plus/checkout", async (c) => {
  const buyerId = c.req.query("buyer") ?? "";
  const buyer = buyerId
    ? await c.env.DB.prepare("SELECT id, name, email, stripe_customer_id FROM buyers WHERE id = ?").bind(buyerId)
        .first<{ id: string; name: string; email: string | null; stripe_customer_id: string | null }>()
    : null;
  if (!buyer) return c.text("unknown buyer", 404);
  await c.env.DB.prepare(SUBSCRIPTIONS_DDL).run().catch(() => {});
  if (await isPlus(c.env, buyerId)) return c.redirect("/buy/orders");
  if (stubMode(c.env)) {
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO subscriptions (buyer_id, stripe_subscription_id, status, current_period_end) VALUES (?, ?, 'active', ?)",
    ).bind(buyerId, `sub_stub_${buyerId}`, new Date(Date.now() + 30 * 864e5).toISOString()).run();
    return c.redirect("/buy/orders");
  }
  if (!c.env.BUYER_PLUS_PRICE_ID) return c.text("Plus is not configured yet (missing price).", 500);
  const customer = await ensureCustomer(c.env, buyer);
  const session = await stripe(c.env).checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: c.env.BUYER_PLUS_PRICE_ID, quantity: 1 }],
    client_reference_id: buyerId,
    success_url: `${c.env.PUBLIC_URL}/buy/orders`,
    cancel_url: `${c.env.PUBLIC_URL}/buy/plus?buyer=${buyerId}`,
  });
  return c.redirect(session.url!);
});

/** Admin/judge revenue view: ledger totals plus the most recent settled sales. */
payments.get("/api/revenue", requireApiKey, async (c) => {
  let rows: { auction_id: string; title: string; clearing_cents: number; fee_bps: number; fee_cents: number; status: string; ended_at: string }[] = [];
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT pf.auction_id, COALESCE(sk.title, 'item') AS title, pf.clearing_cents, pf.fee_bps, pf.fee_cents, a.status, a.ended_at
         FROM platform_fees pf JOIN auctions a ON a.id = pf.auction_id
         LEFT JOIN snaps sn ON sn.id = a.snap_id LEFT JOIN skus sk ON sk.id = sn.sku_id
        WHERE a.payment_intent_id NOT LIKE 'pi_stub_%'
        ORDER BY pf.created_at DESC LIMIT 50`,
    ).all<{ auction_id: string; title: string; clearing_cents: number; fee_bps: number; fee_cents: number; status: string; ended_at: string }>();
    rows = results;
  } catch { /* pre-ledger database: empty ledger */ }
  const paid = rows.filter((r) => r.status === "captured" || r.status === "released");
  let plus = { active: 0, mrrCents: 0 };
  let expressFeesCents = 0;
  try {
    const sub = await c.env.DB.prepare(
      `SELECT COUNT(*) AS active FROM subscriptions WHERE status IN ('active', 'trialing')
        AND (current_period_end IS NULL OR current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).first<{ active: number }>();
    plus = { active: sub?.active ?? 0, mrrCents: (sub?.active ?? 0) * PLUS_MONTHLY_CENTS };
    const ex = await c.env.DB.prepare("SELECT COALESCE(SUM(express_fee_cents), 0) AS total FROM platform_fees").first<{ total: number }>();
    expressFeesCents = ex?.total ?? 0;
  } catch { /* pre-ledger database: extras stay zero */ }
  return c.json({
    feeBps: sellerFeeBps(c.env),
    sales: paid.length,
    grossCents: paid.reduce((s, r) => s + r.clearing_cents, 0),
    feesCents: paid.reduce((s, r) => s + r.fee_cents, 0),
    expressFeesCents,
    plus,
    recent: rows.slice(0, 20),
  });
});

/** Buyer payment limit. Fallback path: Checkout in setup mode saves a card; cap enforced in settleAuction. */
payments.get("/buy/setup", async (c) => {
  const buyerId = c.req.query("buyer");
  const buyer = buyerId
    ? await c.env.DB.prepare("SELECT id, name, email, stripe_customer_id FROM buyers WHERE id = ?").bind(buyerId)
        .first<{ id: string; name: string; email: string | null; stripe_customer_id: string | null }>()
    : null;
  if (!buyer) return c.text("unknown buyer", 404);
  if (stubMode(c.env)) return c.redirect(`/buy/done?buyer=${buyer.id}`);

  const s = stripe(c.env);
  const customer = await ensureCustomer(c.env, buyer);
  const session = await s.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    payment_method_types: ["card"],
    client_reference_id: buyer.id,
    success_url: `${c.env.PUBLIC_URL}/buy/done?buyer=${buyer.id}`,
    cancel_url: `${c.env.PUBLIC_URL}/buy`,
  });
  return c.redirect(session.url!);
});

/**
 * Create a Connect recipient with the Accounts v2 API. Stripe now blocks Accounts v1
 * (Express/Custom) creation by default, so sellers are v2 accounts configured for separate
 * charges & transfers: the platform is the fees/losses collector, and the account gets the
 * stripe_transfers capability (activated once the seller finishes hosted onboarding).
 */
async function createSellerAccount(env: Env, sellerId: string): Promise<string> {
  const account = await stripe(env).v2.core.accounts.create({
    // Required for a recipient config. We only have the seller's Telegram, so use a reserved
    // non-deliverable placeholder; the seller sets their real email during hosted onboarding.
    // TODO(C): collect the seller's email up front and use it here.
    contact_email: `${sellerId}@seller.invalid`,
    identity: { country: "US", entity_type: "individual" },
    defaults: { currency: "usd", responsibilities: { fees_collector: "application", losses_collector: "application" } },
    configuration: {
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
    dashboard: "none",
    metadata: { sellerId },
  });
  return account.id;
}

/** Seller payouts via Connect (Accounts v2 recipient). */
payments.get("/sell/onboard", async (c) => {
  const sellerId = c.req.query("seller");
  const seller = sellerId
    ? await c.env.DB.prepare("SELECT id, stripe_account_id FROM sellers WHERE id = ?").bind(sellerId).first<{ id: string; stripe_account_id: string | null }>()
    : null;
  if (!seller) return c.text("unknown seller", 404);
  if (stubMode(c.env)) return c.text("Stub mode: payouts onboarding skipped.");

  const s = stripe(c.env);
  let account = seller.stripe_account_id;
  if (!account) {
    account = await createSellerAccount(c.env, seller.id);
    await c.env.DB.prepare("UPDATE sellers SET stripe_account_id = ? WHERE id = ?").bind(account, seller.id).run();
  }
  // Hosted onboarding via AccountLinks works for v2 accounts and activates the capability.
  const link = await s.accountLinks.create({
    account,
    type: "account_onboarding",
    refresh_url: `${c.env.PUBLIC_URL}/sell/onboard?seller=${seller.id}`,
    return_url: `${c.env.PUBLIC_URL}/`,
  });
  return c.redirect(link.url);
});

// Manual/admin triggers. The Telegram buttons call capture/release directly.
payments.post("/api/auctions/:id/confirm", requireApiKey, async (c) => {
  await capture(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

payments.post("/api/auctions/:id/shipped", requireApiKey, async (c) => {
  const { tracking } = await c.req.json<{ tracking: string }>();
  const a = await loadAuction(c.env, c.req.param("id"));
  if (!a?.buyer_id) return c.json({ error: "not found" }, 404);
  await notify(c.env, { buyerId: a.buyer_id }, { type: "shipped", auctionId: a.id, title: a.title, tracking });
  return c.json({ ok: true });
});

payments.post("/api/auctions/:id/delivered", requireApiKey, async (c) => {
  const { express } = await c.req.json<{ express?: boolean }>().catch(() => ({}) as { express?: boolean });
  if (express) await releaseExpress(c.env, c.req.param("id"));
  else await release(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

payments.post("/api/auctions/:id/cancel", requireApiKey, async (c) => {
  await voidAuthorization(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

payments.post("/api/auctions/:id/refund", requireApiKey, async (c) => {
  await refund(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// Owner: C. Payment limits, authorize/capture, Connect payouts.
// Stub mode: with no STRIPE_SECRET_KEY, every call succeeds with fake ids so A/B/D can test the full loop.
import { Hono } from "hono";
import Stripe from "stripe";
import { notify } from "./telegram";
import { requireApiKey, type App } from "./lib/util";
import type { Env, RankedBid, SettleResult } from "./types";

export function stripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

const stubMode = (env: Env) => !env.STRIPE_SECRET_KEY;

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

/** HANDOFF A → C. Delivered: transfer clearing price minus fee to the seller's Connect account. */
export async function release(env: Env, auctionId: string): Promise<void> {
  const a = await loadAuction(env, auctionId);
  if (!a || a.status !== "captured" || a.clearing_cents == null) throw new Error("auction not releasable");
  const amount = a.clearing_cents - Math.round((a.clearing_cents * Number(env.SELLER_FEE_BPS || "1000")) / 10_000);
  let transferId = `tr_stub_${auctionId}`;
  if (!stubMode(env)) {
    if (!a.stripe_account_id) throw new Error("seller has no Connect account");
    // TODO(C): subtract shipping label cost once labels exist.
    const t = await stripe(env).transfers.create(
      { amount, currency: "usd", destination: a.stripe_account_id, transfer_group: `auction_${auctionId}` },
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
  let customer = buyer.stripe_customer_id;
  if (!customer) {
    customer = (await s.customers.create({ name: buyer.name, email: buyer.email ?? undefined, metadata: { buyerId: buyer.id } })).id;
    await c.env.DB.prepare("UPDATE buyers SET stripe_customer_id = ? WHERE id = ?").bind(customer, buyer.id).run();
  }
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

/** Seller payouts via Connect Express. */
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
    account = (await s.accounts.create({ type: "express", metadata: { sellerId: seller.id } })).id;
    await c.env.DB.prepare("UPDATE sellers SET stripe_account_id = ? WHERE id = ?").bind(account, seller.id).run();
  }
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
  await release(c.env, c.req.param("id"));
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

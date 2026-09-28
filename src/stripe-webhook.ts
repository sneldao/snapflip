// Owner: C. Stripe webhooks (signature verified).
import { Hono } from "hono";
import Stripe from "stripe";
import { stripe } from "./payments";
import type { App } from "./lib/util";

export const stripeWebhook = new Hono<App>();

/** current_period_end moved across Stripe API versions — read it defensively. */
function subPeriodEndIso(sub: Stripe.Subscription): string | null {
  const s = sub as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
  const ts = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

stripeWebhook.post("/webhooks/stripe", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.text("missing signature", 400);
  const body = await c.req.text();
  const s = stripe(c.env);

  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return c.text("bad signature", 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (!session.client_reference_id) break;
      if (session.mode === "subscription" && session.subscription) {
        // Buyer Plus: mirror the subscription row from Stripe (source of truth).
        const sub = await s.subscriptions.retrieve(session.subscription as string);
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO subscriptions (buyer_id, stripe_subscription_id, status, current_period_end)
           VALUES (?, ?, ?, ?)`,
        ).bind(
          session.client_reference_id,
          sub.id,
          sub.status,
          subPeriodEndIso(sub),
        ).run();
        break;
      }
      if (session.mode !== "setup" || !session.setup_intent) break;
      const si = await s.setupIntents.retrieve(session.setup_intent as string);
      await c.env.DB.prepare("UPDATE buyers SET payment_method_id = ? WHERE id = ?")
        .bind(si.payment_method as string, session.client_reference_id)
        .run();
      break;
    }
    // Backup path for the above: keyed on the Stripe customer, so it works even if
    // checkout.session.completed is missed. Covers docs' setup_intent.succeeded.
    case "setup_intent.succeeded": {
      const si = event.data.object;
      if (si.payment_method && si.customer) {
        await c.env.DB.prepare("UPDATE buyers SET payment_method_id = ? WHERE stripe_customer_id = ?")
          .bind(si.payment_method as string, si.customer as string)
          .run();
      }
      break;
    }
    // Buyer Plus lifecycle: keep the entitlement row in sync with Stripe.
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await c.env.DB.prepare(
        "UPDATE subscriptions SET status = ?, current_period_end = ? WHERE stripe_subscription_id = ?",
      ).bind(sub.status, subPeriodEndIso(sub), sub.id).run();
      break;
    }
    case "account.updated": {      const account = event.data.object;
      await c.env.DB.prepare("UPDATE sellers SET payouts_enabled = ? WHERE stripe_account_id = ?")
        .bind(account.payouts_enabled ? 1 : 0, account.id)
        .run();
      break;
    }
    // Reconcile: authorization landed. Normally persistAndSettle already wrote this; this
    // catches the case where the settle response was lost after Stripe confirmed.
    case "payment_intent.amount_capturable_updated": {
      const pi = event.data.object;
      const auctionId = pi.metadata?.auctionId;
      if (auctionId) {
        await c.env.DB.prepare(
          "UPDATE auctions SET status = 'settled', payment_intent_id = ? WHERE id = ? AND status = 'cleared'",
        ).bind(pi.id, auctionId).run();
      }
      break;
    }
    // Async auth failure/cancel after settle: mark failed and reopen the winning order.
    case "payment_intent.canceled":
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      const auctionId =
        pi.metadata?.auctionId ??
        (await c.env.DB.prepare("SELECT id FROM auctions WHERE payment_intent_id = ?").bind(pi.id).first<{ id: string }>())?.id;
      if (!auctionId) break;
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE auctions SET status = 'failed' WHERE id = ? AND status = 'settled'").bind(auctionId),
        c.env.DB.prepare(
          "UPDATE orders SET status = 'open' WHERE id = (SELECT winner_order_id FROM auctions WHERE id = ?) AND status = 'filled'",
        ).bind(auctionId),
      ]);
      console.log("payment intent issue", event.type, pi.id, "auction", auctionId);
      break;
    }
    default:
      break;
  }
  return c.json({ received: true });
});

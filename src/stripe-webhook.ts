// Owner: C. Stripe webhooks (signature verified).
import { Hono } from "hono";
import Stripe from "stripe";
import { stripe } from "./payments";
import type { App } from "./lib/util";

export const stripeWebhook = new Hono<App>();

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
      if (session.mode !== "setup" || !session.setup_intent || !session.client_reference_id) break;
      const si = await s.setupIntents.retrieve(session.setup_intent as string);
      await c.env.DB.prepare("UPDATE buyers SET payment_method_id = ? WHERE id = ?")
        .bind(si.payment_method as string, session.client_reference_id)
        .run();
      break;
    }
    case "account.updated": {
      const account = event.data.object;
      await c.env.DB.prepare("UPDATE sellers SET payouts_enabled = ? WHERE stripe_account_id = ?")
        .bind(account.payouts_enabled ? 1 : 0, account.id)
        .run();
      break;
    }
    case "payment_intent.canceled":
    case "payment_intent.payment_failed": {
      // TODO(C): mark auction failed and offer to the next bidder.
      console.log("payment intent issue", event.type, event.data.object.id);
      break;
    }
    default:
      break;
  }
  return c.json({ received: true });
});

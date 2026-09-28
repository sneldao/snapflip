// Owner: D. Buyer onboarding: create buyer → payment limit (C's /buy/setup) → first standing order → link Telegram.
import { Hono } from "hono";
import { html } from "hono/html";
import { z } from "zod";
import { createOrder } from "../orders";
import { newId, type App } from "../lib/util";
import { layout } from "./layout";

export const buy = new Hono<App>();

buy.get("/buy", (c) =>
  c.html(
    layout(
      "SnapFlip: set a standing order",
      html`<h1>What are you hunting for?</h1>
        <p class="muted">Your agent bids for you in live auctions, never above your max.</p>
        <form method="post" action="/buy" class="card">
          <label for="name">Name</label><input id="name" name="name" required maxlength="80" autocomplete="name" />
          <label for="email">Email</label><input id="email" name="email" type="email" maxlength="120" autocomplete="email" />
          <label for="rules">What you want</label>
          <input id="rules" name="rules" required maxlength="500" placeholder="Pokemon Yellow, authentic, label in good shape" />
          <label for="max">Max price (USD)</label><input id="max" name="max" type="number" min="1" max="1000" step="1" required />
          <p><button type="submit">Save card and set order</button></p>
        </form>`,
    ),
  ),
);

const Form = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(120).optional().or(z.literal("")),
  rules: z.string().min(3).max(500),
  max: z.coerce.number().int().min(1).max(1000),
});

buy.post("/buy", async (c) => {
  const parsed = Form.safeParse(await c.req.parseBody());
  if (!parsed.success) return c.text("Please fill in all fields.", 400);
  const { name, email, rules, max } = parsed.data;
  const buyerId = newId("b");
  const limitCents = max * 100;
  // Payment limit = the max they entered, valid 30 days. TODO(C): replace with SPT limits.
  const expires = new Date(Date.now() + 30 * 864e5).toISOString();
  await c.env.DB.prepare("INSERT INTO buyers (id, name, email, limit_cents, limit_expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(buyerId, name, email || null, limitCents, expires)
    .run();
  try {
    await createOrder(c.env, { buyerId, rulesText: rules, maxCents: limitCents });
  } catch (e) {
    return c.text(`Couldn't create that order: ${(e as Error).message}`, 400);
  }
  return c.redirect(`/buy/setup?buyer=${buyerId}`);
});

buy.get("/buy/done", (c) => {
  const buyerId = c.req.query("buyer") ?? "";
  const bot = c.env.TELEGRAM_BOT_USERNAME;
  return c.html(
    layout(
      "SnapFlip: you're in",
      html`<h1>Your agent is live.</h1>
        <p class="muted">It will bid the moment a matching item is snapped.</p>
        ${bot
          ? html`<p><a class="button" href="https://t.me/${bot}?start=${buyerId}">Get pinged on Telegram</a></p>`
          : html`<p class="muted">Buyer id: ${buyerId}</p>`}`,
    ),
  );
});

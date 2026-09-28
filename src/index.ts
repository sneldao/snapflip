// Router only. Each workstream owns its sub-router; add routes there, not here.
import { Hono } from "hono";
import { auctions } from "./auction";
import { handleMatchBatch } from "./match";
import { mcpAuth } from "./mcp";
import { orders } from "./orders";
import { payments, voidExpiredAuths } from "./payments";
import { stripeWebhook } from "./stripe-webhook";
import { telegram } from "./telegram";
import { auctionPage } from "./web/auction";
import { buy } from "./web/buy";
import { landing } from "./web/landing";
import { missingSecrets, type App } from "./lib/util";
import type { Env, MatchJob } from "./types";

const app = new Hono<App>();

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// Production boot guard: the Stripe/Claude/Telegram stub fallbacks are dev-only. Outside dev,
// refuse requests loudly when a required secret is missing instead of silently running on stubs.
app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  const missing = missingSecrets(c.env);
  if (missing.length) {
    console.error(`production misconfigured; missing secrets: ${missing.join(", ")}`);
    return c.json({ error: "server misconfigured" }, 500);
  }
  await next();
});

app.route("/", landing); // D
app.route("/", buy); // D
app.route("/", auctionPage); // A
app.route("/", telegram); // A
app.route("/", orders); // B
app.route("/", auctions); // B
app.route("/", payments); // C
app.route("/", stripeWebhook); // C

// D: remote MCP (Streamable HTTP), behind per-buyer tokens (auth inside mcp.ts).
app.all("/mcp", mcpAuth);
app.all("/mcp/*", mcpAuth);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default {
  fetch: app.fetch,
  queue: (batch, env) => {
    const missing = missingSecrets(env);
    if (missing.length) {
      // Not acked: messages redeliver once the deploy is fixed.
      console.error(`queue batch skipped; production missing secrets: ${missing.join(", ")}`);
      return;
    }
    return handleMatchBatch(batch, env);
  },
  scheduled: (_event, env, ctx) => {
    const missing = missingSecrets(env);
    if (missing.length) {
      console.error(`cron skipped; production missing secrets: ${missing.join(", ")}`);
      return;
    }
    ctx.waitUntil(voidExpiredAuths(env));
  },
} satisfies ExportedHandler<Env, MatchJob>;

export { AuctionDO } from "./auction";
export { BuyerAgent } from "./buyer";
export { SnapflipMCP } from "./mcp";

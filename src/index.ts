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
import type { App } from "./lib/util";
import type { Env, MatchJob } from "./types";

const app = new Hono<App>();

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

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
  queue: (batch, env) => handleMatchBatch(batch, env),
  scheduled: (_event, env, ctx) => ctx.waitUntil(voidExpiredAuths(env)),
} satisfies ExportedHandler<Env, MatchJob>;

export { AuctionDO } from "./auction";
export { BuyerAgent } from "./buyer";
export { SnapflipMCP } from "./mcp";

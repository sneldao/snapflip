// Owner: D. Remote MCP server so buyers manage standing orders from Claude.
// Mounted at /mcp. Auth: per-buyer token as `Authorization: Bearer <t>` or `?token=<t>`
// (Claude.ai custom connectors only take a URL, so the query form is the main path).
// The resolved buyerId is passed to the agent DO via ctx.props AND injected as the
// `x-sf-buyer` request header, which the transport forwards into each tool call's
// extra.requestInfo — agents persists props from the first request of a session only,
// so the per-request header is what actually authorizes every call.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestInfo } from "@modelcontextprotocol/sdk/types.js";
import { McpAgent } from "agents/mcp";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { auctionStub } from "./auction";
import { buyerAgent } from "./buyer";
import { buyerIdForToken } from "./lib/tokens";
import { usd, type App } from "./lib/util";
import { cancelOrder, createOrder, listOrders, orderbook } from "./orders";
import type { Env } from "./types";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const BUYER_HEADER = "x-sf-buyer";

export class SnapflipMCP extends McpAgent<Env, unknown, { buyerId: string }> {
  server = new McpServer(
    { name: "snapflip", version: "0.1.0" },
    {
      instructions:
        "SnapFlip runs live auctions for retro games. All amounts are integer cents. " +
        "The buyer's agent bids automatically, never above the order's maxCents or the buyer's payment limit. " +
        "Call catalog before creating orders so the rules text names real items. Call my_account for the buyer's limit.",
    },
  );

  /** Per-request buyer: the header is set by mcpAuth from the validated token on THIS request. */
  private buyerId(requestInfo?: RequestInfo): string {
    const h = requestInfo?.headers[BUYER_HEADER];
    const perRequest = Array.isArray(h) ? h[0] : h;
    const bound = this.props?.buyerId;
    if (perRequest && bound && perRequest !== bound) {
      throw new Error("This MCP session is bound to a different buyer. Start a new session with your own connector URL.");
    }
    const id = perRequest ?? bound;
    if (!id) throw new Error("missing buyer");
    return id;
  }

  async init(): Promise<void> {
    // SDK quirk: tools without inputSchema are called as cb(extra), not cb(args, extra).
    const wrap = <Args>(fn: (args: Args, buyerId: string) => Promise<unknown>) =>
      async (argsOrExtra: Args | { requestInfo?: RequestInfo }, extra?: { requestInfo?: RequestInfo }) => {
        try {
          const requestInfo = (extra ?? (argsOrExtra as { requestInfo?: RequestInfo })).requestInfo;
          return text(await fn(argsOrExtra as Args, this.buyerId(requestInfo)));
        } catch (e) {
          return fail((e as Error).message);
        }
      };

    this.server.registerTool(
      "catalog",
      { description: "Items that standing orders can match: id, title, platform, region, reference price in cents." },
      wrap(async () => {
        const { results } = await this.env.DB.prepare(
          "SELECT id, title, platform, region, ref_price_cents AS refPriceCents FROM skus ORDER BY title",
        ).all();
        return results;
      }),
    );

    this.server.registerTool(
      "orderbook",
      { description: "Current standing demand per item (collector counts and total demand; individual bids are private)." },
      wrap(async () => orderbook(this.env)),
    );

    this.server.registerTool(
      "my_account",
      { description: "Your account: payment limit, whether a card and Telegram are linked, and setup links." },
      wrap(async (_a, buyerId) => {
        const b = await this.env.DB.prepare(
          "SELECT name, limit_cents, limit_expires_at, payment_method_id, tg_chat_id FROM buyers WHERE id = ?",
        ).bind(buyerId).first<{
          name: string; limit_cents: number; limit_expires_at: string | null;
          payment_method_id: string | null; tg_chat_id: string | null;
        }>();
        if (!b) throw new Error("unknown buyer");
        const bot = this.env.TELEGRAM_BOT_USERNAME;
        return {
          name: b.name,
          limitCents: b.limit_cents,
          limitExpiresAt: b.limit_expires_at,
          cardSaved: b.payment_method_id != null,
          telegramLinked: b.tg_chat_id != null,
          setupUrl: `${this.env.PUBLIC_URL}/buy/setup?buyer=${buyerId}`,
          ...(bot ? { telegramUrl: `https://t.me/${bot}?start=${buyerId}` } : {}),
        };
      }),
    );

    this.server.registerTool(
      "create_standing_order",
      {
        description:
          "Create a standing buy order. Your agent will bid automatically in live auctions for matching items, up to maxCents. " +
          "Describe the item and conditions in plain English, e.g. 'Pokemon Yellow, authentic, label in good shape'.",
        inputSchema: {
          rulesText: z.string().min(3).max(500),
          maxCents: z.number().int().positive().max(100_000),
        },
      },
      wrap(async ({ rulesText, maxCents }, buyerId) => {
        const b = await this.env.DB.prepare("SELECT limit_cents FROM buyers WHERE id = ?").bind(buyerId)
          .first<{ limit_cents: number }>();
        if (!b) throw new Error("unknown buyer");
        if (maxCents > b.limit_cents) {
          throw new Error(`Your payment limit is ${usd(b.limit_cents)}. Set maxCents at or below it.`);
        }
        const order = await createOrder(this.env, { buyerId, rulesText, maxCents });
        const matchedTitles = order.rules.skuIds.length
          ? (
              await this.env.DB.prepare(
                `SELECT title FROM skus WHERE id IN (${order.rules.skuIds.map(() => "?").join(",")})`,
              ).bind(...order.rules.skuIds).all<{ title: string }>()
            ).results.map((r) => r.title)
          : [];
        return { ...order, matchedTitles };
      }),
    );

    this.server.registerTool(
      "raise_max",
      {
        description:
          "Raise an order's max when your agent dropped out of a live auction and you want back in. " +
          "Capped at your payment limit in code — it can never bid above that.",
        inputSchema: {
          auctionId: z.string(),
          orderId: z.string(),
          maxCents: z.number().int().positive().max(100_000),
        },
      },
      wrap(async ({ auctionId, orderId, maxCents }, buyerId) =>
        buyerAgent(this.env, buyerId).raise(buyerId, auctionId, orderId, maxCents),
      ),
    );

    this.server.registerTool(
      "list_my_orders",
      { description: "List your standing orders." },
      wrap(async (_a, buyerId) => listOrders(this.env, buyerId)),
    );

    this.server.registerTool(
      "cancel_order",
      { description: "Cancel an open standing order.", inputSchema: { orderId: z.string() } },
      wrap(async ({ orderId }, buyerId) => ({ cancelled: await cancelOrder(this.env, buyerId, orderId) })),
    );

    this.server.registerTool(
      "get_auction",
      { description: "Live state of an auction: price, active agents, dropouts, winner.", inputSchema: { auctionId: z.string() } },
      wrap(async ({ auctionId }) => auctionStub(this.env, auctionId).getView()),
    );
  }
}

export const mcpHandler = SnapflipMCP.serve("/mcp", { binding: "MCP_OBJECT" });

/** Per-buyer token auth for /mcp: Bearer header or ?token= query. 401 JSON on missing/unknown. */
export const mcpAuth: MiddlewareHandler<App> = async (c) => {
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer || new URL(c.req.url).searchParams.get("token") || undefined;
  const buyerId = await buyerIdForToken(c.env, token);
  if (!buyerId) return c.json({ error: "unauthorized" }, 401);

  const req = new Request(c.req.raw);
  req.headers.set(BUYER_HEADER, buyerId); // overwrite any client-supplied value
  const ctx = c.executionCtx as ExecutionContext;
  const ctxWithProps = {
    waitUntil: ctx.waitUntil.bind(ctx),
    passThroughOnException: ctx.passThroughOnException.bind(ctx),
    props: { buyerId },
  } as unknown as ExecutionContext;
  return mcpHandler.fetch(req, c.env, ctxWithProps);
};

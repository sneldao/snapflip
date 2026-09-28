// Owner: D. Remote MCP server so buyers (or their agents) can manage standing orders from Claude.
// Mounted at /mcp behind the API key. TODO(D): per-buyer tokens (buyers.token_hash) instead of passing buyerId.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { auctionStub } from "./auction";
import { cancelOrder, createOrder, listOrders, orderbook } from "./orders";
import type { Env } from "./types";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export class SnapflipMCP extends McpAgent<Env> {
  server = new McpServer({ name: "snapflip", version: "0.1.0" });

  async init(): Promise<void> {
    this.server.registerTool(
      "orderbook",
      { description: "Current standing demand per item (collector counts and total demand; individual bids are private)." },
      async () => text(await orderbook(this.env)),
    );

    this.server.registerTool(
      "create_standing_order",
      {
        description:
          "Create a standing buy order. Your agent will bid automatically in live auctions for matching items, up to maxCents. " +
          "Describe the item and conditions in plain English, e.g. 'Pokemon Yellow, authentic, label in good shape'.",
        inputSchema: {
          buyerId: z.string(),
          rulesText: z.string().min(3).max(500),
          maxCents: z.number().int().positive().max(100_000),
        },
      },
      async (args) => text(await createOrder(this.env, args)),
    );

    this.server.registerTool(
      "list_my_orders",
      { description: "List your standing orders.", inputSchema: { buyerId: z.string() } },
      async ({ buyerId }) => text(await listOrders(this.env, buyerId)),
    );

    this.server.registerTool(
      "cancel_order",
      { description: "Cancel an open standing order.", inputSchema: { buyerId: z.string(), orderId: z.string() } },
      async ({ buyerId, orderId }) => text({ cancelled: await cancelOrder(this.env, buyerId, orderId) }),
    );

    this.server.registerTool(
      "get_auction",
      { description: "Live state of an auction: price, active agents, dropouts, winner.", inputSchema: { auctionId: z.string() } },
      async ({ auctionId }) => text(await auctionStub(this.env, auctionId).getView()),
    );
  }
}

export const mcpHandler = SnapflipMCP.serve("/mcp", { binding: "MCP_OBJECT" });

// Owner: B. Standing orders and the aggregated order book.
import { Hono } from "hono";
import { z } from "zod";
import { newId, requireApiKey, type App } from "./lib/util";
import type { Env, Order, OrderRules } from "./types";

export const CreateOrderInput = z.object({
  buyerId: z.string().min(1),
  rulesText: z.string().min(3).max(500),
  maxCents: z.number().int().positive().max(100_000),
  skuIds: z.array(z.string()).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

/** TODO(B): replace with a Claude call that returns OrderRules from rulesText + SKU catalog. */
async function parseRules(env: Env, input: CreateOrderInput): Promise<OrderRules> {
  let skuIds = input.skuIds ?? [];
  if (skuIds.length === 0) {
    const { results } = await env.DB.prepare("SELECT id, title FROM skus").all<{ id: string; title: string }>();
    const text = input.rulesText.toLowerCase();
    skuIds = results.filter((s) => text.includes(s.title.toLowerCase().replace(/ version$/, ""))).map((s) => s.id);
  }
  return { skuIds, maxCents: input.maxCents, gradeCaps: {}, require: [], reject: ["reproduction"] };
}

export async function createOrder(env: Env, input: CreateOrderInput): Promise<Order> {
  const buyer = await env.DB.prepare("SELECT id FROM buyers WHERE id = ?").bind(input.buyerId).first();
  if (!buyer) throw new Error("unknown buyer");

  const rules = await parseRules(env, input);
  if (rules.skuIds.length === 0) throw new Error("could not match any item in the catalog");
  // Money cap comes from the input, never from the model.
  rules.maxCents = input.maxCents;

  const id = newId("o");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO orders (id, buyer_id, rules_text, rules_json, max_cents) VALUES (?, ?, ?, ?, ?)").bind(
      id, input.buyerId, input.rulesText, JSON.stringify(rules), input.maxCents,
    ),
    ...rules.skuIds.map((sku) => env.DB.prepare("INSERT INTO order_skus (order_id, sku_id) VALUES (?, ?)").bind(id, sku)),
  ]);
  return (await getOrder(env, id))!;
}

type OrderRow = { id: string; buyer_id: string; rules_text: string; rules_json: string; max_cents: number; status: Order["status"]; expires_at: string | null; created_at: string };
const toOrder = (r: OrderRow): Order => ({
  id: r.id, buyerId: r.buyer_id, rulesText: r.rules_text, rules: JSON.parse(r.rules_json),
  maxCents: r.max_cents, status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
});

export async function getOrder(env: Env, id: string): Promise<Order | null> {
  const r = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<OrderRow>();
  return r ? toOrder(r) : null;
}

export async function listOrders(env: Env, buyerId: string): Promise<Order[]> {
  const { results } = await env.DB.prepare("SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC").bind(buyerId).all<OrderRow>();
  return results.map(toOrder);
}

export async function cancelOrder(env: Env, buyerId: string, orderId: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND buyer_id = ? AND status = 'open'").bind(orderId, buyerId).run();
  return r.meta.changes > 0;
}

/** Public demand summary. Never exposes individual max prices (they're private bids). */
export async function orderbook(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id AS sku_id, s.title, s.platform, COUNT(DISTINCT o.id) AS orders, COUNT(DISTINCT o.buyer_id) AS collectors, SUM(o.max_cents) AS demand_cents
       FROM orders o JOIN order_skus os ON os.order_id = o.id JOIN skus s ON s.id = os.sku_id
      WHERE o.status = 'open' GROUP BY s.id ORDER BY demand_cents DESC`,
  ).all<{ sku_id: string; title: string; platform: string; orders: number; collectors: number; demand_cents: number }>();
  const totals = await env.DB.prepare(
    "SELECT COUNT(DISTINCT buyer_id) AS collectors, COALESCE(SUM(max_cents), 0) AS demand_cents FROM orders WHERE status = 'open'",
  ).first<{ collectors: number; demand_cents: number }>();
  return { collectors: totals?.collectors ?? 0, demandCents: totals?.demand_cents ?? 0, skus: results };
}

export const orders = new Hono<App>();

orders.get("/api/orderbook", async (c) => c.json(await orderbook(c.env)));

orders.post("/api/orders", requireApiKey, async (c) => {
  const parsed = CreateOrderInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  try {
    return c.json(await createOrder(c.env, parsed.data), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

orders.get("/api/orders", requireApiKey, async (c) => {
  const buyerId = c.req.query("buyerId");
  if (!buyerId) return c.json({ error: "buyerId required" }, 400);
  return c.json(await listOrders(c.env, buyerId));
});

orders.post("/api/orders/:id/cancel", requireApiKey, async (c) => {
  const { buyerId } = await c.req.json<{ buyerId: string }>();
  return c.json({ cancelled: await cancelOrder(c.env, buyerId, c.req.param("id")) });
});

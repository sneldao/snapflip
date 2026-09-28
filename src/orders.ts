// Owner: B. Standing orders and the aggregated order book.
import { Hono } from "hono";
import { z } from "zod";
import { buyerAgent } from "./buyer";
import { claudeJson, llmAvailable } from "./lib/claude";
import { CONDITION_FLAGS, knownFlags } from "./lib/flags";
import { newId, requireApiKey, type App } from "./lib/util";
import { pingWatchers } from "./watches";
import type { Env, Grade, Order, OrderRules } from "./types";

export const CreateOrderInput = z.object({
  buyerId: z.string().min(1),
  rulesText: z.string().min(3).max(500),
  maxCents: z.number().int().positive().max(100_000),
  skuIds: z.array(z.string()).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

const GRADES: Grade[] = ["A", "B", "C", "D"];

type CatalogRow = { id: string; title: string; platform: string | null; region: string | null };

/** Raw, untrusted shape from Claude — validated and clamped in code before use. */
interface RawRules {
  skuIds?: string[];
  gradeCaps?: Record<string, number>;
  reject?: string[];
  require?: string[];
}

/** Deterministic fallback: substring match on title. Used with no API key or if Claude fails. */
function fallbackRules(input: CreateOrderInput, catalog: CatalogRow[]): OrderRules {
  let skuIds = input.skuIds ?? [];
  if (skuIds.length === 0) {
    const text = input.rulesText.toLowerCase();
    skuIds = catalog.filter((s) => text.includes(s.title.toLowerCase().replace(/ version$/, ""))).map((s) => s.id);
  }
  return { skuIds, maxCents: input.maxCents, gradeCaps: {}, require: [], reject: ["reproduction"] };
}

/**
 * Turn a collector's plain-English order into structured rules. Claude picks the SKUs and
 * condition-sensitive pricing; code enforces every money cap, the SKU catalog, and the flag
 * vocabulary so a bad model response can never over-spend or match the wrong item.
 */
async function parseRules(env: Env, input: CreateOrderInput): Promise<OrderRules> {
  const { results: catalog } = await env.DB.prepare("SELECT id, title, platform, region FROM skus").all<CatalogRow>();
  const known = new Set(catalog.map((s) => s.id));

  if (!llmAvailable(env)) return fallbackRules(input, catalog);

  let raw: RawRules;
  try {
    raw = await claudeJson<RawRules>(env, {
      maxTokens: 500,
      system: `You convert a collector's plain-English buy order into structured JSON rules for retro video game cartridges.

Catalog (id | title | platform | region):
${catalog.map((s) => `${s.id} | ${s.title} | ${s.platform ?? ""} | ${s.region ?? ""}`).join("\n")}

The buyer's overall maximum is ${input.maxCents} cents. Never return a price above that.
All prices are integer cents.

Shape:
{
  "skuIds": string[],   // every catalog id this order could match; [] if none fit
  "gradeCaps": { "A"?: cents, "B"?: cents, "C"?: cents, "D"?: cents },  // most the buyer pays at each grade; omit a grade to use the overall max; 0 means REJECT that grade
  "reject": string[],   // condition flags that disqualify the item
  "require": string[]   // condition flags that MUST be present (rare — usually [])
}

Grades: A=near mint, B=light wear, C=heavy wear/label damage, D=damaged or incomplete.
The ONLY condition flags you may use: ${CONDITION_FLAGS.join(", ")}.
Mapping guidance:
- "authentic" / "genuine" / "no bootleg or repro" -> reject ["reproduction"]
- "no water damage" -> reject ["water_damage"]
- "mint" / "near mint only" -> gradeCaps {"B":0,"C":0,"D":0}
- "B or better" -> gradeCaps {"C":0,"D":0}
- "up to $45, $30 if the label is worn" -> gradeCaps {"C": 3000} and overall max 4500
- "any Gen 1 Pokemon" -> include every matching catalog id.`,
      content: [{ type: "text", text: input.rulesText }],
    });
  } catch (e) {
    console.error("rule parse failed, using fallback:", (e as Error).message);
    return fallbackRules(input, catalog);
  }

  const skuIds = (input.skuIds?.length ? input.skuIds : (raw.skuIds ?? [])).filter((id) => known.has(id));

  const gradeCaps: Partial<Record<Grade, number>> = {};
  for (const g of GRADES) {
    const v = raw.gradeCaps?.[g];
    // Clamp each grade cap into [0, maxCents]; the model never sets the ceiling.
    if (typeof v === "number" && Number.isFinite(v)) gradeCaps[g] = Math.min(Math.max(0, Math.round(v)), input.maxCents);
  }

  const reject = knownFlags(raw.reject);
  if (!reject.includes("reproduction")) reject.push("reproduction"); // repros always disqualified in this category
  const require = knownFlags(raw.require);

  return { skuIds, maxCents: input.maxCents, gradeCaps, require, reject };
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
  // Ping any seller watching for this demand — must never fail the order itself.
  await pingWatchers(env, { buyerId: input.buyerId, skuIds: rules.skuIds }).catch((e) => console.error("pingWatchers failed", e));
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

const RaiseInput = z.object({
  buyerId: z.string().min(1),
  auctionId: z.string().min(1),
  maxCents: z.number().int().positive().max(100_000),
});

// Raise an order's max mid-auction (Telegram "raise your max", MCP, or concierge).
orders.post("/api/orders/:id/raise", requireApiKey, async (c) => {
  const parsed = RaiseInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { buyerId, auctionId, maxCents } = parsed.data;
  try {
    const view = await buyerAgent(c.env, buyerId).raise(buyerId, auctionId, c.req.param("id"), maxCents);
    return c.json(view);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

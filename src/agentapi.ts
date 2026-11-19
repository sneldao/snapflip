// Owner: E. x402-gated agent surface. The human UI keeps its free rate-limited
// /api/market + /api/collection; external agents pay per call here, in a PLT through
// the configured facilitator (which can sponsor network fees — docs/CONCORDIUM.md §6).
// Unconfigured → 503: agents get nothing for free, not data they didn't pay for.
import { Hono } from "hono";
import { collectionPayload, marketLookup, parseCollectionItems, parseMarketQuery } from "./market";
import { X402_SETTLE_DDL, x402Enabled, x402Gate } from "./lib/x402";
import { feeLedgerRow, sellerFeeBps, splitFee } from "./lib/fees";
import { notify } from "./telegram";
import { nowIso, type App } from "./lib/util";

export const agentapi = new Hono<App>();

agentapi.use("/api/agent/*", async (c, next) => {
  if (!x402Enabled(c.env)) return c.json({ error: "x402 agent payments not configured" }, 503);
  return x402Gate(c.env)(c, next);
});

agentapi.get("/api/agent/market", async (c) => {
  const query = parseMarketQuery(c.req.query("q"));
  if (!query) return c.json({ error: "q must be 2-140 chars" }, 400);
  if (!c.env.TAVILY_API_KEY) return c.json({ error: "market lookup not configured" }, 503);
  try {
    return c.json(await marketLookup(c.env, query));
  } catch {
    return c.json({ error: "market lookup failed" }, 502);
  }
});

agentapi.get("/api/agent/collection", async (c) => {
  const items = parseCollectionItems(c.req.query("items"));
  if (!items.length) return c.json({ error: "items must be 1-8 |-separated names, 2-140 chars each" }, 400);
  if (!c.env.TAVILY_API_KEY) return c.json({ error: "market lookup not configured" }, 503);
  return c.json(await collectionPayload(c.env, items));
});

/** The winning agent settles the clearing price in a PLT (charged by the middleware at
 *  the auction's own clearing_cents). Payment is verified before this handler runs and
 *  settled after it returns. Only auctions parked in awaiting_agent_payment (the x402
 *  settle rail) may complete here — anything else is a 409 so a Stripe-railed auction
 *  can't be paid for twice. */
agentapi.post("/api/agent/auctions/:id/settle", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(X402_SETTLE_DDL).run();
  const a = await c.env.DB.prepare(
    `SELECT a.status, a.payment_rail, a.winner_order_id, a.clearing_cents,
            sn.seller_id, COALESCE(sk.title, 'item') AS title
       FROM auctions a JOIN snaps sn ON sn.id = a.snap_id
       LEFT JOIN skus sk ON sk.id = sn.sku_id
      WHERE a.id = ?`,
  )
    .bind(id)
    .first<{ status: string; payment_rail: string | null; winner_order_id: string | null; clearing_cents: number | null; seller_id: string; title: string }>();
  if (!a) return c.json({ error: "auction not found" }, 404);
  if (a.status !== "awaiting_agent_payment" || a.payment_rail !== "x402") {
    return c.json({ error: "auction not awaiting an agent payment", status: a.status }, 409);
  }

  const ledger = a.clearing_cents != null ? feeLedgerRow(id, a.clearing_cents, sellerFeeBps(c.env)) : null;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE auctions SET status = 'settled' WHERE id = ?").bind(id),
    c.env.DB.prepare(
      `INSERT INTO x402_settlements (auction_id, payer, at) VALUES (?, ?, ?)
         ON CONFLICT(auction_id) DO UPDATE SET payer = excluded.payer, at = excluded.at`,
    ).bind(id, payerFromHeader(c.req.header("x-payment")), nowIso()),
    ...(ledger
      ? [c.env.DB.prepare("INSERT OR IGNORE INTO platform_fees (auction_id, clearing_cents, fee_bps, fee_cents) VALUES (?, ?, ?, ?)")
          .bind(ledger.auction_id, ledger.clearing_cents, ledger.fee_bps, ledger.fee_cents)]
      : []),
  ]);
  if (a.clearing_cents != null) {
    const { netCents } = splitFee(a.clearing_cents, sellerFeeBps(c.env));
    await notify(c.env, { sellerId: a.seller_id }, { type: "presold", auctionId: id, title: a.title, priceCents: a.clearing_cents, netCents });
  }
  return c.json({ ok: true, auctionId: id, rail: "x402" });
});

/** The X-PAYMENT header is a base64 payment payload — decode it for the payer account
 *  when the shape exposes one. Best-effort; the receipt's authoritative record is on-chain. */
function payerFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  try {
    const j = JSON.parse(atob(header)) as Record<string, unknown>;
    const payload = (j.payload ?? j) as Record<string, unknown>;
    for (const key of ["payer", "account", "sender", "from"]) {
      const v = payload[key] ?? j[key];
      if (typeof v === "string" && v.length > 20) return v;
    }
    return null;
  } catch {
    return null;
  }
}

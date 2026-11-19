// Owner: E. x402 paywall for agent-facing API surfaces (/api/agent/*).
// The hosted facilitator verifies and settles each payment — and can sponsor the
// network fee, so paying agents never hold CCD for gas (docs/CONCORDIUM.md §6).
// Off unless X402_FACILITATOR_URL and X402_PAYEE are both set.
import type { MiddlewareHandler } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient, type HTTPRequestContext, type RoutesConfig } from "@x402/core/server";
import type { Network, Price } from "@x402/core/types";
import { ExactConcordiumScheme } from "@x402/concordium/exact/server";
import type { Env } from "../types";

// Kept inline (rather than imported from ./concordium) so this module stays
// node-resolvable for tests — mirror of TESTNET_CAIP2 there.
const TESTNET_CAIP2 = "ccd:4221332d34e1694168c2a0c0b3fd0f27";

type X402Env = Pick<Env, "CCD_NETWORK" | "X402_FACILITATOR_URL" | "X402_PAYEE" | "X402_PRICE" | "SETTLE_RAIL" | "X402_ASSET" | "X402_ASSET_DECIMALS">;
type DbEnv = X402Env & Pick<Env, "DB">;

export const X402_SETTLE_DDL = `CREATE TABLE IF NOT EXISTS x402_settlements (
  auction_id TEXT PRIMARY KEY REFERENCES auctions(id),
  payer TEXT,                      -- account that presented the X-PAYMENT proof
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

export function x402Enabled(env: X402Env): boolean {
  return Boolean(env.X402_FACILITATOR_URL && env.X402_PAYEE);
}

/**
 * Which rail secures the winner's payment. "x402" only when explicitly asked for
 * AND the facilitator is configured — otherwise Stripe (the safe default: a card
 * auth guarantees the seller gets paid even if an agent disappears).
 * With x402 the auction parks in awaiting_agent_payment until the winning agent
 * calls the settle endpoint and pays the clearing price on-chain.
 */
export function settleRail(env: X402Env): "x402" | "stripe" {
  return env.SETTLE_RAIL === "x402" && x402Enabled(env) ? "x402" : "stripe";
}

const usdPrice = (env: X402Env) => env.X402_PRICE || "$0.05";

/** Price in the configured asset. Default "$…" resolves to USDR via the scheme's
 *  default-asset table. On testnet the live PLT is EURQ, so set X402_ASSET=EURQ
 *  (X402_ASSET_DECIMALS, default 6) and prices are emitted in atomic asset units —
 *  e.g. X402_PRICE=0.05 → 50000 EURQ base units. */
export function assetPrice(env: X402Env, units: number): Price {
  const asset = env.X402_ASSET;
  if (!asset) return `$${units.toFixed(2)}`;
  const decimals = Number(env.X402_ASSET_DECIMALS ?? 6) || 6;
  return { amount: String(Math.round(units * 10 ** decimals)), asset };
}

// Middleware is stateless across requests except the facilitator /supported sync —
// cache per config so the sync happens once per isolate, not once per request.
let mwCache: { key: string; mw: MiddlewareHandler } | undefined;

/** The /api/agent/* paywall. Route prices: fixed for data calls, dynamic for settle —
 * the settle charge is the auction's own clearing price, looked up by path. */
export function x402Gate(env: DbEnv): MiddlewareHandler {
  const key = `${env.X402_FACILITATOR_URL}|${env.X402_PAYEE}`;
  if (!mwCache || mwCache.key !== key) {
    const network = (env.CCD_NETWORK || TESTNET_CAIP2) as Network;
    const server = new x402ResourceServer(
      new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL! }),
    ).register(network, new ExactConcordiumScheme());

    const payTo = env.X402_PAYEE!;
    const accepts = (price: Price | ((ctx: HTTPRequestContext) => Promise<Price>)) => ({
      scheme: "exact",
      network,
      payTo,
      price,
    });

    const routes: RoutesConfig = {
      "GET /api/agent/market": {
        accepts: accepts(assetPrice(env, Number(usdPrice(env).replace("$", "")) || 0.05)),
        description: "Market reference price for a secondhand item",
        mimeType: "application/json",
      },
      "GET /api/agent/collection": {
        // Price scales with the number of items appraised.
        accepts: accepts(async (ctx: HTTPRequestContext) => {
          const items = String(ctx.adapter.getQueryParam?.("items") ?? "").split("|").filter(Boolean).length || 1;
          const base = Number(usdPrice(env).replace("$", "")) || 0.05;
          return assetPrice(env, base * items);
        }),
        description: "Per-item market references plus collection total (up to 8 items)",
        mimeType: "application/json",
      },
      "POST /api/agent/auctions/*/settle": {
        // The charge is the auction's clearing price — the winning agent pays
        // exactly what the clock stopped at.
        accepts: accepts(async (ctx: HTTPRequestContext) => {
          const id = ctx.path.split("/")[4];
          const a = await env.DB.prepare("SELECT clearing_cents FROM auctions WHERE id = ?")
            .bind(id)
            .first<{ clearing_cents: number | null }>();
          if (!a?.clearing_cents) throw new Error("auction not cleared");
          return assetPrice(env, a.clearing_cents / 100);
        }),
        description: "Winning agent settles the clearing price",
        mimeType: "application/json",
      },
    };

    mwCache = { key, mw: paymentMiddleware(routes, server) };
  }
  return mwCache.mw;
}

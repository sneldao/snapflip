// Owner: E. Verified by Concordium badge checks via the hosted Agent Registry API.
// A passing check means the agent is registered in a CIS-8004 registry, is Active,
// is owned by an identity-verified Concordium account, and its published Agent Card
// matches the on-chain hash. The registry is the trust root — not the party
// presenting the badge. See docs/CONCORDIUM.md.
import type { Env, Valuation } from "../types";

/** Just the env surface the badge layer reads — a raw object literal satisfies it in tests. */
export type ConcordiumEnv = Pick<Env, "CCD_NETWORK" | "CCD_REGISTRY_API" | "CCD_REGISTRY_NETWORK" | "REQUIRE_AGENT_BADGE">;

/** Buyer-side agent identity. Kept as its own table so pre-badge databases need no ALTER —
 *  ensured lazily like PLATFORM_FEES_DDL (CREATE IF NOT EXISTS is cheap). */
export const AGENT_IDENTITY_DDL = `CREATE TABLE IF NOT EXISTS agent_identities (
  buyer_id TEXT PRIMARY KEY REFERENCES buyers(id),
  badge TEXT,                      -- CIS-8004 token address, Base58Check short form
  ccd_account TEXT,                -- Concordium account owning the agent NFT
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

export const TESTNET_CAIP2 = "ccd:4221332d34e1694168c2a0c0b3fd0f27";
const DEFAULT_REGISTRY_API = "https://agent-registry-mcp.concordium.com";
export const CARD_URI = "/.well-known/agent-card.json";

type CardEnv = Pick<
  Env,
  | "PUBLIC_URL"
  | "CCD_NETWORK"
  | "CCD_REGISTRY_API"
  | "CCD_REGISTRY_NETWORK"
  | "SNAPFLIP_AGENT_BADGE"
  | "AGENT_TOKEN_ID"
  | "AGENT_OWNER_ACCOUNT"
  | "REGISTRY_CONTRACT"
  | "CIS8_CONTRACT"
>;

/** The platform's Agent Card — combined ERC-8004 registration file and A2A v1.0 card.
 *  Badge + registrations blocks appear only once the fleet is actually registered —
 *  an unregistered card must not claim a badge. The served bytes are SHA-256'd into
 *  on-chain metadata, so output is deterministic for a given env: change env, re-anchor. */
export function buildAgentCard(env: CardEnv): Record<string, unknown> {
  const chain = env.CCD_NETWORK || TESTNET_CAIP2;
  const registryApi = env.CCD_REGISTRY_API || DEFAULT_REGISTRY_API;
  const network = env.CCD_REGISTRY_NETWORK || "testnet";
  const base = env.PUBLIC_URL.replace(/\/$/, "");
  const cardUrl = `${base}${CARD_URI}`;
  const badge = env.SNAPFLIP_AGENT_BADGE;
  const registry = env.REGISTRY_CONTRACT;

  const extensions =
    badge && registry
      ? [
          {
            uri: "https://docs.concordium.com/a2a-extensions/concordium-badge/v1",
            description:
              "Verified by Concordium badge — the agent's on-chain identity in a CIS-8004 registry, owned by an identity-verified account",
            required: false,
            params: {
              tokenAddress: `${chain}/cis-2:${badge}`,
              ...(env.AGENT_OWNER_ACCOUNT ? { owner: { account: `${chain}:${env.AGENT_OWNER_ACCOUNT}` } } : {}),
              contracts: {
                cis8004: `${chain}:${registry}`,
                ...(env.CIS8_CONTRACT ? { cis8: `${chain}:${env.CIS8_CONTRACT}` } : {}),
              },
              verify:
                "Resolve tokenAddress via CIS-8004 agent_of; confirm status Active and that SHA-256 of this card equals the on-chain metadata_hash.",
              verification: {
                service: "Concordium Agent Registry",
                verifyUrl: `${registryApi}/v1/badge-check/${badge}?network=${network}`,
                mcp: `${registryApi}/mcp`,
                docs: "https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html",
              },
            },
          },
        ]
      : [];

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "SnapFlip Buyer Agent",
    description:
      "Bids autonomously in SnapFlip's 60-second clock auctions for secondhand goods, inside a human-set standing order and spending limit. Pays the clearing price over x402 on Concordium; every bid and refusal lands in a hash-anchored audit trail.",
    image: `${base}/media/storefront.jpg`,
    version: "0.1.0",
    provider: { organization: "SnapFlip", url: base },
    supportedInterfaces: [{ url: `${base}/mcp`, protocolBinding: "MCP", protocolVersion: "2025-06-18" }],
    capabilities: { streaming: false, pushNotifications: false, extensions },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "standing-order",
        name: "Standing orders",
        description: "Converts a plain-English buy order into SKU, grade and price rules the agent bids inside.",
        tags: ["commerce", "orders"],
      },
      {
        id: "live-bidding",
        name: "Live bidding",
        description: "Bids in ascending clock auctions, dropping at the order's walk-away price.",
        tags: ["auction", "bidding"],
      },
      {
        id: "appraisal",
        name: "Collection appraisal",
        description: "Prices items and boxes off real collector-index comps.",
        tags: ["pricing", "comps"],
      },
    ],
    services: [
      { name: "MCP", endpoint: `${base}/mcp`, version: "2025-06-18" },
      { name: "A2A", endpoint: cardUrl, version: "1.0" },
    ],
    x402Support: true,
    active: true,
    registrations:
      env.AGENT_TOKEN_ID && registry ? [{ agentId: Number(env.AGENT_TOKEN_ID), agentRegistry: `${chain}:${registry}` }] : [],
  };
}

const registryApi = (env: ConcordiumEnv) => env.CCD_REGISTRY_API || DEFAULT_REGISTRY_API;
const registryNetwork = (env: ConcordiumEnv) => env.CCD_REGISTRY_NETWORK || "testnet";

/** Join-gate switch. Off until the fleet is registered — see docs/CONCORDIUM.md §5. */
export function badgeGateEnabled(env: ConcordiumEnv): boolean {
  return env.REQUIRE_AGENT_BADGE === "true" || env.REQUIRE_AGENT_BADGE === "1";
}

export interface BadgeVerdict {
  verified: boolean;
  subject: string;
  /** Valid badged agents found (account checks); 1 or 0 for single-badge checks. */
  agents: number;
  issues: string[];
  raw: unknown;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; v: BadgeVerdict }>();

async function getJson(env: ConcordiumEnv, path: string): Promise<{ status: number; body: unknown }> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${registryApi(env)}${path}${sep}network=${registryNetwork(env)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: { error: `registry unreachable: ${(e as Error).message}` } };
  }
}

/** Map a badge-check API response to a verdict. Pure — kept separate for tests. */
export function badgeVerdictFromResponse(status: number, body: unknown, id: string): BadgeVerdict {
  if (status !== 200) {
    const err = (body as { error?: string })?.error;
    return { verified: false, subject: id, agents: 0, issues: [`registry returned HTTP ${status}`, err].filter(Boolean) as string[], raw: body };
  }
  const b = body as {
    badge_valid?: boolean;
    issues?: string[];
    summary?: { valid?: number };
  };
  if (typeof b.badge_valid === "boolean") {
    // Single-badge form: { badge_valid, issues }
    return {
      verified: b.badge_valid,
      subject: id,
      agents: b.badge_valid ? 1 : 0,
      issues: b.issues ?? [],
      raw: body,
    };
  }
  // Account form: { agent_count, summary: { valid, invalid }, agents }
  const valid = Number(b.summary?.valid ?? 0);
  return {
    verified: valid > 0,
    subject: id,
    agents: valid,
    issues: valid > 0 ? [] : ["account owns no valid badged agent"],
    raw: body,
  };
}

/** Check one badge (token address) or an account (all agents it owns). 60s cache, fails closed. */
export async function checkBadge(env: ConcordiumEnv, id: string): Promise<BadgeVerdict> {
  const key = `${registryNetwork(env)}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.v;
  const { status, body } = await getJson(env, `/v1/badge-check/${encodeURIComponent(id)}`);
  const v = badgeVerdictFromResponse(status, body, id);
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** Full badge JSON (owner, status, agent_uri, wallet) for receipts and display. */
export async function getBadgeJson(env: ConcordiumEnv, tokenAddress: string): Promise<unknown> {
  const { status, body } = await getJson(env, `/v1/get-badge-JSON/${encodeURIComponent(tokenAddress)}`);
  if (status !== 200) throw new Error(`badge ${tokenAddress}: HTTP ${status}`);
  return body;
}

/** On-chain metadata_hash vs SHA-256 of the hosted Agent Card. */
export async function verifyAgentCard(env: ConcordiumEnv, tokenAddress: string): Promise<unknown> {
  const { body } = await getJson(env, `/v1/verify-agent-card/${encodeURIComponent(tokenAddress)}`);
  return body;
}

export interface Refusal {
  orderId: string;
  buyerId: string;
  reason: string;
}

type DbEnv = ConcordiumEnv & Pick<Env, "DB">;

/** A buyer's current badge binding, if any. */
export async function badgeForBuyer(env: Pick<Env, "DB">, buyerId: string): Promise<{ badge: string | null; ccdAccount: string | null }> {
  await env.DB.prepare(AGENT_IDENTITY_DDL).run();
  const row = await env.DB.prepare("SELECT badge, ccd_account FROM agent_identities WHERE buyer_id = ?")
    .bind(buyerId)
    .first<{ badge: string | null; ccd_account: string | null }>();
  return { badge: row?.badge ?? null, ccdAccount: row?.ccd_account ?? null };
}

/**
 * Bind a buyer's agent to its Verified by Concordium badge. Verifies against the
 * registry first and records the badge's owner account for the audit trail.
 * Throws with the registry's reason when the badge doesn't verify.
 * NOTE: this proves the badge is valid, not that the caller controls its owner keys —
 * proof of possession is the CIS-8 signature flow (office-hours question).
 */
export async function bindAgentBadge(env: DbEnv, buyerId: string, badge: string): Promise<{ badge: string; ccdAccount: string | null }> {
  const verdict = await checkBadge(env, badge);
  if (!verdict.verified) {
    throw new Error(`badge not verified: ${verdict.issues.join("; ") || "registry rejected it"}`);
  }
  let ccdAccount: string | null = null;
  try {
    const j = (await getBadgeJson(env, badge)) as Record<string, unknown>;
    const owner = j.owner ?? j.owner_account ?? j.account;
    ccdAccount = typeof owner === "string" ? owner : null;
  } catch {
    // Owner account is for receipts; a badge that verified but won't describe
    // itself is still bindable.
  }
  await env.DB.prepare(AGENT_IDENTITY_DDL).run();
  await env.DB.prepare(
    `INSERT INTO agent_identities (buyer_id, badge, ccd_account) VALUES (?, ?, ?)
       ON CONFLICT(buyer_id) DO UPDATE SET badge = excluded.badge, ccd_account = excluded.ccd_account`,
  )
    .bind(buyerId, badge, ccdAccount)
    .run();
  return { badge, ccdAccount };
}

/** Remove a buyer's badge binding — the agent becomes unverified again. */
export async function unbindAgentBadge(env: Pick<Env, "DB">, buyerId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM agent_identities WHERE buyer_id = ?").bind(buyerId).run();
}

const BADGE_CHECK_CONCURRENCY = 5;

/**
 * Split would-be bidders into admitted and refused. Gate off → everyone admitted, no
 * network calls. Gate on → each candidate must present a badge that verifies; a missing
 * badge or a registry failure refuses the agent (fail closed — an agent that can't be
 * verified doesn't bid). Refusals are returned for the auction's event log, not dropped
 * silently: the refusal IS the accountability record.
 */
export async function admitBidders(
  env: ConcordiumEnv,
  candidates: Valuation[],
): Promise<{ admitted: Valuation[]; refused: Refusal[] }> {
  if (!badgeGateEnabled(env)) return { admitted: candidates, refused: [] };

  const admitted: Valuation[] = [];
  const refused: Refusal[] = [];
  const pending = candidates.map((v, i) => ({ v, i }));
  for (let i = 0; i < pending.length; i += BADGE_CHECK_CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + BADGE_CHECK_CONCURRENCY).map(async ({ v }) => {
        if (!v.badge) {
          refused.push({ orderId: v.orderId, buyerId: v.buyerId, reason: "no Verified by Concordium badge" });
          return;
        }
        const verdict = await checkBadge(env, v.badge);
        if (verdict.verified) {
          admitted.push(v);
        } else {
          refused.push({
            orderId: v.orderId,
            buyerId: v.buyerId,
            reason: `badge rejected: ${verdict.issues[0] ?? "not verified"}`,
          });
        }
      }),
    );
  }
  // Keep original candidate order — the earliest-wins tie-break depends on it.
  const order = new Map(candidates.map((v, i) => [v.orderId, i]));
  admitted.sort((a, b) => order.get(a.orderId)! - order.get(b.orderId)!);
  refused.sort((a, b) => order.get(a.orderId)! - order.get(b.orderId)!);
  return { admitted, refused };
}

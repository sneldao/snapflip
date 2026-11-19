// Shared contracts. Change a type here only after telling the team.
import type { AuctionDO } from "./auction";
import type { BuyerAgent } from "./buyer";
import type { SnapflipMCP } from "./mcp";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  MATCH_QUEUE: Queue<MatchJob>;
  AUCTION: DurableObjectNamespace<AuctionDO>;
  BUYER: DurableObjectNamespace<BuyerAgent>;
  MCP_OBJECT: DurableObjectNamespace<SnapflipMCP>;
  /** Anonymous studio engagement events. Absent = events are dropped. */
  STUDIO_EVENTS?: AnalyticsEngineDataset;

  ENVIRONMENT: string; // "dev" enables /dev/* routes and stub fallbacks
  PUBLIC_URL: string;
  CLAUDE_MODEL: string;
  SELLER_FEE_BPS: string;
  /** Stripe Price id for Buyer Plus ($6/mo recurring). Absent = Plus checkout disabled. */
  BUYER_PLUS_PRICE_ID?: string;
  /** Rush fee for express seller payout, bps. Defaults to 100 (1%). */
  EXPRESS_FEE_BPS?: string;
  TELEGRAM_BOT_USERNAME?: string;

  // Secrets
  API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
  // Fallback provider (OpenAI-compatible): used when ANTHROPIC_API_KEY is absent or fails.
  FEATHERLESS_API_KEY?: string;
  FEATHERLESS_MODEL?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BRAINBASE_LABS_API_KEY?: string;
  /** Web search for real-world sold-price comps (/api/market). Absent = endpoint 503s. */
  TAVILY_API_KEY?: string;

  // Concordium (docs/CONCORDIUM.md). All optional — the badge gate defaults off.
  /** CAIP-2 chain id. Defaults to testnet ccd:4221332d34e1694168c2a0c0b3fd0f27. */
  CCD_NETWORK?: string;
  /** Hosted Agent Registry API base. Defaults to https://agent-registry-mcp.concordium.com. */
  CCD_REGISTRY_API?: string;
  /** Registry network param for badge-check calls. Defaults to "testnet". */
  CCD_REGISTRY_NETWORK?: string;
  /** "true"/"1": refuse unbadged agents at the auction join gate. */
  REQUIRE_AGENT_BADGE?: string;
  /** The platform's own badge (Base58Check token address), embedded in the Agent Card. */
  SNAPFLIP_AGENT_BADGE?: string;
  /** CIS-8004 token id of the platform agent, for the card's registrations block. */
  AGENT_TOKEN_ID?: string;
  /** Concordium account (CAIP-10 without chain prefix is also fine) owning the fleet. */
  AGENT_OWNER_ACCOUNT?: string;
  /** "<index>.<subindex>" of the testnet CIS-8004 registry contract. */
  REGISTRY_CONTRACT?: string;
  /** "<index>.<subindex>" of the testnet CIS-8 key registry, if bound. */
  CIS8_CONTRACT?: string;

  // x402 agent-payment surface (/api/agent/*, docs/CONCORDIUM.md). Both must be set
  // for the gate to engage; unset = endpoints return 503 and the free routes are unaffected.
  /** Facilitator base URL that verifies+settles payments (and may sponsor network fees). */
  X402_FACILITATOR_URL?: string;
  /** Concordium account address receiving x402 payments. */
  X402_PAYEE?: string;
  /** Price for a paid market/collection call, e.g. "$0.05" (resolved to a PLT by the scheme). */
  X402_PRICE?: string;
  /** "x402": winners pay the clearing price on-chain via /api/agent/auctions/:id/settle
   *  instead of a Stripe authorize. Only engages when the x402 gate is configured. */
  SETTLE_RAIL?: string;
  /** Price asset override — e.g. "EURQ" on testnet (USDR is the SDK's default). */
  X402_ASSET?: string;
  /** Decimals for X402_ASSET (default 6). */
  X402_ASSET_DECIMALS?: string;
}

// Lets the Agents SDK classes (typed against Cloudflare.Env) see our bindings.
type AppEnv = Env;
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

export type Grade = "A" | "B" | "C" | "D";

export interface Sku {
  id: string;
  category: string;
  title: string;
  platform: string | null;
  region: string | null;
  refPriceCents: number;
}

/** Structured form of a buyer's plain-English rules (parsed by Claude in orders.ts). */
export interface OrderRules {
  skuIds: string[];
  maxCents: number;
  /** Per-grade cap. Missing grade = maxCents. 0 = not acceptable. */
  gradeCaps: Partial<Record<Grade, number>>;
  require: string[];
  reject: string[];
  expiresAt?: string;
}

export type OrderStatus = "open" | "filled" | "cancelled" | "expired";

export interface Order {
  id: string;
  buyerId: string;
  rulesText: string;
  rules: OrderRules;
  maxCents: number;
  status: OrderStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface Identification {
  skuId: string | null;
  title: string;
  confidence: number; // 0..1
  alternatives: { skuId: string; title: string; confidence: number }[];
}

export interface GradeReport {
  grade: Grade;
  notes: string;
  flags: string[]; // e.g. "reproduction", "water_damage", "label_wear"
  /** What the grader actually saw — the appraisal's evidence lines.
   *  `box` is normalized [x,y,w,h] in the photo when the spot is localizable. */
  findings: { area: string; observation: string; box?: [number, number, number, number] }[];
  /** Normalized [x,y,w,h] bounds of the item in the photo. */
  itemBox?: [number, number, number, number];
}

export interface ProofVerdict {
  verdict: "match" | "unclear" | "mismatch";
  notes: string;
  confidence: number;
}

export interface Snap {
  id: string;
  sellerId: string;
  r2Key: string;
  skuId: string | null;
  title: string;
  confidence: number;
  grade: Grade;
  gradeNotes: string;
  findings?: { area: string; observation: string; box?: [number, number, number, number] }[];
  itemBox?: [number, number, number, number];
  flags: string[];
  rackCents: number | null;
  reserveCents: number | null;
}

/** One buyer agent's private valuation of one snap. dropoutCents is already capped in code. */
export interface Valuation {
  orderId: string;
  buyerId: string;
  eligible: boolean;
  dropoutCents: number;
  /** Hard ceiling for raises: min(order max, buyer payment limit). */
  limitCents: number;
  reason: string;
  /** Verified by Concordium badge (CIS-8004 token address) of the buyer's agent, if registered. */
  badge?: string | null;
}

export type AuctionStatus = "live" | "cleared" | "no_sale";

export type BidEventType = "join" | "drop" | "raise" | "win" | "refused";

export interface BidEvent {
  orderId: string;
  event: BidEventType;
  priceCents: number;
  reason?: string;
  at: string;
}

/** WebSocket message from AuctionDO, and the /api/auctions/:id response. */
export interface AuctionView {
  type: "state";
  id: string;
  snapId: string;
  title: string;
  status: AuctionStatus;
  priceCents: number;
  reserveCents: number;
  endsAt: number; // epoch ms
  /** True during the soft-close "going once" window: price holds, dropped agents may raise back in. */
  closing?: boolean;
  /** Live take rate in basis points, so clients can quote the seller net as the clock ticks. */
  feeBps: number;
  active: { orderId: string; label: string; verified?: boolean }[];
  dropped: { orderId: string; label: string; atCents: number; reason: string; verified?: boolean }[];
  /** Agents refused at the join gate (missing or rejected Verified by Concordium badge). */
  refused?: { orderId: string; label: string; reason: string }[];
  winner?: { orderId: string; label: string; priceCents: number; feeBps: number; feeCents: number; netCents: number };
}

/** Winner first, then fallbacks in order — everyone pays the same clearing price. */
export interface RankedBid {
  orderId: string;
  priceCents: number;
}

export type SettleResult =
  | { ok: true; orderId: string; paymentIntentId: string; priceCents: number }
  | { ok: false; reason: string };

export interface NotifyTarget {
  buyerId?: string;
  sellerId?: string;
}

export type NotifyEvent =
  | { type: "agent_dropped"; auctionId: string; orderId: string; title: string; atCents: number; reason: string }
  | { type: "auction_won"; auctionId: string; title: string; priceCents: number; maxCents: number }
  | { type: "presold"; auctionId: string; title: string; priceCents: number; netCents: number }
  | { type: "no_sale"; auctionId: string; title: string }
  | { type: "settlement_failed"; auctionId: string; title: string; reason: string }
  | { type: "captured"; auctionId: string; title: string; priceCents: number }
  | { type: "shipped"; auctionId: string; title: string; tracking: string }
  | { type: "released"; auctionId: string; amountCents: number };

export interface MatchJob {
  snapId: string;
}

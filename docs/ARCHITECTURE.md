# Architecture

One Cloudflare Worker (router), plus two Durable Object classes, D1, R2 and a Queue. The buyer and seller interfaces are thin; the logic lives in the Worker.

```
BUYER SIDE                                   SELLER SIDE
Claude (MCP) ─┐                              Telegram photo
Brainbase ────┼─► POST /api/orders           │
Web /buy ─────┘     │                        ▼
                    ▼                        /telegram/webhook
             BuyerAgent DO (per buyer)       │  R2 put photo
             - orders + rules                ▼
             - payment limit                 Claude: identify SKU + grade
             - notify channel                │
                    ▲                        ▼
                    │  join / drop           candidate orders (D1 by sku_id)
                    │                        │  Claude: verify match + value per order
                    └──────── AuctionDO (per auction) ◄──┘
                              - alarm-driven price clock
                              - WebSocket fan-out (seller + /a/{id} page)
                              │ cleared
                              ▼
                    Stripe PaymentIntent (manual capture)
                              │ seller confirms purchase (photo)
                              ▼
                    capture ─► ship ─► delivered ─► Transfer to seller (Connect)
                              │
                    Telegram pings: buyer "your agent won", seller "pre-sold"
```

## Auction design

**Format: ascending clock auction (Japanese auction), 60 seconds.**

- The price starts at the seller's reserve and goes up by a set increment on every tick (Durable Object alarm, about every 2s). The increment is 5% of the reference price, rounded to $1.
- Each eligible buyer agent has a **private dropout price**: what its buyer would pay for *this* item at *this* grade (see "Agent valuation").
- On each tick, agents whose dropout price is below the current price leave. That's shown live as "Agent #3 dropped at $31."
- **Ends** when one agent remains (it wins at the current price) or the 60s cap is reached (the highest remaining agent wins at the current price, earliest order breaks ties).
- **One eligible bidder:** it wins at the reserve, after a 10s window for others to join.
- **No bidders, or the reserve isn't met:** no sale. The seller is offered a fallback: a fixed-price listing at the reference price that future standing orders can match.

Why a clock auction: the result is the same as a second-price auction, so each agent's best strategy is to bid its true value. Agents don't need to play games, sniping is pointless, and the rising ticker makes a great live show.

**Human override (optional drama):** when a buyer's agent drops out, the buyer gets a Telegram message: "Dropped at $31. Raise your max?" A raise within the window puts the agent back in and adds 10s to the close (soft close, max 2 extensions).

## Agent valuation

At order creation, Claude turns the buyer's plain-English rules into structured data:

```json
{
  "sku_ids": ["gb-pokemon-yellow-us"],
  "max_cents": 4500,
  "grade_caps": {"A": 4500, "B": 3800, "C": 2500},
  "require": ["authentic_label", "cart_only_ok"],
  "reject": ["reproduction", "water_damage"],
  "expires_at": "2026-12-31T00:00:00Z"
}
```

At auction time, for each candidate order, Claude receives the photo, the grade report and the rules. It returns `{eligible: bool, dropout_cents: int, reason: string}`. The dropout price is capped by the order's `max_cents` and the payment limit, and this is enforced in code, not trusted from the model. The reason is shown to the buyer afterwards ("Dropped at $38: label wear pushed it to grade B").

## Catalog scale

Both SKU touchpoints — `identify()` in `vision.ts` and `parseRules()` in `orders.ts` — paste the **entire** `skus` table into the prompt. That's correct while the retro-games catalog is dozens of rows; it breaks once vinyl / LEGO / TCG push it past ~1k items (context cost, then the context limit).

When that happens, add a **hybrid retrieval step** (exact keyword + vector) that returns the top-k catalog candidates, and let the model pick only among those:

- **Keyword side matters.** Title matching ("Pokémon Yellow" vs. regional and variant strings) needs exact-token recall; pure vector search is mediocre at it.
- **One index, two call sites.** `identify` gets candidate titles injected into the vision prompt; `parseRules` gets candidates for `skuIds`. `skus.aliases_json` is already the alias surface — index it alongside titles.
- **Engine:** Cloudflare Vectorize + Workers AI embeddings is the in-stack default (no new vendor, another binding in `wrangler.jsonc`). A managed hybrid service (e.g. Moss) only earns its keep if we ever need sub-10ms mid-conversation retrieval — a voice-agent concern nothing in the product currently has.

Match-time lookup (`findCandidates`, the `order_skus` join) is unaffected — it already runs on exact `sku_id`.

## Components

| Component | Responsibility |
|---|---|
| `src/index.ts` | Router: HTTP endpoints, Telegram webhook, Stripe webhook, MCP mount |
| `src/vision.ts` | Model calls: `identify(photo) → {sku_id, title, confidence}`, `grade(photo) → {grade, notes, flags}` (Anthropic, falling back to Featherless) |
| `src/match.ts` | Candidate lookup (D1) and Claude verification and valuation for each order (fan-out capped at 5 concurrent calls) |
| `src/lib/claude.ts` | Model gateway: Anthropic → Featherless fallback, `llm_cache` response dedupe (D1), 20s attempt timeout, Anthropic prompt caching |
| `src/auction.ts` | `AuctionDO`: state machine, alarm clock, WebSocket fan-out, writes result to D1 |
| `src/buyer.ts` | `BuyerAgent` (Agents SDK): orders, payment reference, notifications, raise-max handling |
| `src/payments.ts` | Stripe: setup, off-session PaymentIntent (manual capture), capture, transfer, Connect onboarding, refund, void-stale-auth sweep (cron) |
| `src/telegram.ts` | Seller and buyer bot messages, inline buttons, live auction message edits |
| `src/mcp.ts` | Remote MCP server (`McpAgent`): buyer tools, authenticated per buyer by token |
| `src/lib/tokens.ts` | Per-buyer bearer tokens (`sf_…`): shown once, stored as SHA-256 (`buyers.token_hash`) |
| `web/` | Landing page (footage-backed hero with the order form inline, snap · bid · sold demo synced to a simulated auction, live order book, guardrails, FAQ; see BUILD.md "Landing page" for the design principles and next step), footage served from `public/media` with byte ranges (`/media/*`), `/a/{id}` live auction page (polaroid snap, pixel-bot agent chips, boss-bar clock, GOING ONCE during soft-close — `AuctionView.closing`), `/buy` onboarding (optional per-grade caps are folded into the rules text the parser reads) and order management. Shared retro-terminal design system in `web/layout.ts` |
| `concierge/` | Brainbase agent manifest + instructions for the hosted buyer concierge (`snapflip-concierge`) |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/telegram/webhook` | Seller photos, reserve input, confirm/ship buttons; buyer raise-max replies |
| POST | `/api/orders` | Create standing order (API key; used by Brainbase concierge) |
| POST | `/api/orders/{id}/raise` | Raise an order's max mid-auction (capped at payment limit) |
| POST | `/api/buyers` | Concierge onboarding: creates buyer + token, returns `mcpUrl`, `setupUrl`, `telegramUrl` |
| GET | `/api/orderbook` | Aggregated demand per SKU (landing page and seller "what's hot") |
| GET | `/api/stats` | Live stats: demand, collectors, real transactions (excludes `b_demo_*` buyers) |
| GET | `/qr` | Booth display: giant QR to `/buy` + live stats |
| GET | `/a/{id}` | Public live auction page |
| GET | `/a/{id}/ws` | WebSocket to `AuctionDO` |
| GET | `/a/{id}/photo` | The snapped item's photo, streamed from R2 (immutable cache) |
| POST | `/api/auctions/{id}/confirm` | Seller bought the item (photo) → capture payment |
| POST | `/api/auctions/{id}/shipped` | Tracking number → buyer notified |
| POST | `/api/auctions/{id}/delivered` | Release funds → Transfer to seller |
| POST | `/api/auctions/{id}/cancel` | Void the authorization (frees the hold, reopens the order) |
| POST | `/api/auctions/{id}/refund` | Dispute: refund a captured payment (pre-transfer only) |
| GET | `/buy/setup` | Stripe Checkout (setup mode) → saved card + code-enforced limit |
| GET | `/buy/orders` | The session buyer's standing orders, with status and parsed grade caps (cookie session) |
| POST | `/buy/orders/{id}/cancel` | Cancel one of the session buyer's open orders |
| GET | `/sell/onboard` | Stripe Connect onboarding link (Accounts v2 recipient — v1 creation is policy-blocked) |
| POST | `/webhooks/stripe` | `checkout.session.completed`, `setup_intent.succeeded`, `payment_intent.*`, `account.updated` |
| — | `/mcp` | MCP tools: `catalog`, `my_account`, `orderbook`, `create_standing_order`, `list_my_orders`, `cancel_order`, `raise_max`, `get_auction`. Auth: per-buyer token (`Bearer` or `?token=`) |

## Payments flow

1. **Payment limit (buyer onboarding).** For the demo: Checkout in `setup` mode saves a PaymentMethod on a Customer; `limit_cents` and `limit_expires_at` are set at signup and enforced in code. A Shared Payment Token scoped to SnapFlip remains the preferred production path — the slot for it is marked `TODO(C)` in `settleAuction`, pending whether SPTs support `capture_method=manual`.
2. **Auction cleared.** Create a PaymentIntent for the clearing price with `capture_method=manual`, `off_session=true`, `confirm=true` and `transfer_group=auction_{id}`. This authorizes without charging. If the authorization fails, the next-highest agent whose dropout covers it wins at the same clearing price — every bidder pays the price the clock stopped at, never their own (higher) maximum.
3. **Seller confirms purchase** (photo of the item in hand) → `capture`. If the seller doesn't confirm within 2h, a 5-minute cron (`voidExpiredAuths`) cancels the PaymentIntent, reopens the winning order, and lowers the seller's reliability score.
4. **Delivered** → `Transfer` of clearing price minus 10% fee minus label cost to the seller's Connect account, same `transfer_group`.
5. **Dispute or not as described** → refund from the platform balance before any transfer. Holding funds until delivery is why we use separate charges and transfers rather than destination charges.

## Data (D1)

```sql
buyers   (id, name, tg_chat_id, email, token_hash, stripe_customer_id, payment_method_id, spt_id, limit_cents, limit_expires_at, created_at)
sellers  (id, tg_chat_id, stripe_account_id, payouts_enabled, reliability, created_at)
skus     (id, category, title, platform, region, variant, aliases_json, ref_price_cents, image_url)
orders   (id, buyer_id, rules_text, rules_json, max_cents, status, expires_at, created_at)
order_skus (order_id, sku_id)                          -- index for matching
snaps    (id, seller_id, r2_key, sku_id, confidence, grade, grade_notes, flags_json, rack_cents, reserve_cents, created_at)
auctions (id, snap_id, status, started_at, ended_at, clearing_cents, winner_order_id, payment_intent_id, transfer_id)
bids     (auction_id, order_id, event, price_cents, reason, at)   -- event: join | drop | raise | win
llm_cache (key, response, created_at)                           -- model response dedupe; key = SHA-256(request)
```

Photos go in R2 (`snaps/{id}.jpg`). Live auction state lives in `AuctionDO` storage and is written to D1 when the auction ends. Per-order model verification runs inline, chunked at 5 concurrent calls per snap (`VERIFY_CONCURRENCY`).

## Trust and safety

- **Shill bidding:** a seller can't bid on their own auction (checked by Telegram ID, Stripe customer and card fingerprint).
- **Wrong identification:** below a confidence threshold, the seller must pick from Claude's top 3 SKUs before the auction starts.
- **Reproductions:** a `reproduction` flag from grading blocks the auction.
- **Model output is advisory for money:** all amounts are capped in code by `max_cents` and `limit_cents`.

## Secrets (`wrangler secret put`, never commit)

`API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus **at least one model provider**: `ANTHROPIC_API_KEY` or `FEATHERLESS_API_KEY` (OpenAI-compatible fallback; `FEATHERLESS_MODEL` var overrides the default model). Optional: `BRAINBASE_LABS_API_KEY`, `PRICECHARTING_API_KEY` (reference prices; otherwise model web search). `TELEGRAM_BOT_USERNAME` is a plain var, not a secret.

The stub fallbacks for Stripe/Claude/Telegram are dev-only. Outside `ENVIRONMENT=development`, a boot guard (`missingSecrets` in `src/lib/util.ts`) refuses HTTP requests (500), skips queue batches (messages redeliver), and skips cron runs when any required secret is absent, so a misconfigured deploy fails loudly instead of silently running on stubs.

Endpoints that change state check a shared secret (Telegram header, Stripe signature, API key for Brainbase/admin endpoints). MCP is authenticated per buyer: `Authorization: Bearer sf_…` or `?token=` (Claude.ai custom connectors only take a URL); the token resolves to a `buyerId` server-side — clients can't pass one. No unauthenticated writes.

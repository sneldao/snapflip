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

## Components

| Component | Responsibility |
|---|---|
| `src/index.ts` | Router: HTTP endpoints, Telegram webhook, Stripe webhook, MCP mount |
| `src/vision.ts` | Claude calls: `identify(photo) → {sku_id, title, confidence}`, `grade(photo) → {grade, notes, flags}` |
| `src/match.ts` | Candidate lookup (D1) and Claude verification and valuation for each order |
| `src/auction.ts` | `AuctionDO`: state machine, alarm clock, WebSocket fan-out, writes result to D1 |
| `src/buyer.ts` | `BuyerAgent` (Agents SDK): orders, payment reference, notifications, raise-max handling |
| `src/payments.ts` | Stripe: setup, off-session PaymentIntent (manual capture), capture, transfer, Connect onboarding |
| `src/telegram.ts` | Seller and buyer bot messages, inline buttons, live auction message edits |
| `src/mcp.ts` | Remote MCP server (`McpAgent`): buyer tools |
| `web/` | Landing page with live order book depth, `/a/{id}` live auction page, `/buy` onboarding |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/telegram/webhook` | Seller photos, reserve input, confirm/ship buttons; buyer raise-max replies |
| POST | `/api/orders` | Create standing order (used by web, Brainbase concierge, MCP) |
| GET | `/api/orderbook` | Aggregated demand per SKU (landing page and seller "what's hot") |
| GET | `/a/{id}` | Public live auction page |
| GET | `/a/{id}/ws` | WebSocket to `AuctionDO` |
| POST | `/api/auctions/{id}/confirm` | Seller bought the item (photo) → capture payment |
| POST | `/api/auctions/{id}/shipped` | Tracking number → buyer notified |
| POST | `/api/auctions/{id}/delivered` | Release funds → Transfer to seller |
| GET | `/buy/setup` | Stripe Checkout (setup mode) or SPT grant → payment limit |
| GET | `/sell/onboard` | Stripe Connect Express onboarding link |
| POST | `/webhooks/stripe` | `setup_intent.succeeded`, `payment_intent.*`, `account.updated`, `transfer.*` |
| — | `/mcp` | MCP tools: `create_standing_order`, `list_my_orders`, `cancel_order`, `get_auction`, `orderbook` |

## Payments flow

1. **Payment limit (buyer onboarding).** Preferred: a Shared Payment Token scoped to SnapFlip with an amount cap and expiry. Fallback: Checkout in `setup` mode saves a PaymentMethod on a Customer, and our code enforces the cap and expiry. Store `limit_cents` and `expires_at` either way.
2. **Auction cleared.** Create a PaymentIntent for the clearing price with `capture_method=manual`, `off_session=true`, `confirm=true` and `transfer_group=auction_{id}`. This authorizes without charging. If the authorization fails, the next-highest agent wins at its own dropout price.
3. **Seller confirms purchase** (photo of the item in hand) → `capture`. If the seller doesn't confirm within 2h, cancel the PaymentIntent and lower the seller's reliability score.
4. **Delivered** → `Transfer` of clearing price minus 10% fee minus label cost to the seller's Connect account, same `transfer_group`.
5. **Dispute or not as described** → refund from the platform balance before any transfer. Holding funds until delivery is why we use separate charges and transfers rather than destination charges.

**Needs checking:** whether PaymentIntents created from SPTs support `capture_method=manual`. If they don't, use the saved-card fallback for the demo.

## Data (D1)

```sql
buyers   (id, name, tg_chat_id, email, stripe_customer_id, payment_method_id, spt_id, limit_cents, limit_expires_at, created_at)
sellers  (id, tg_chat_id, stripe_account_id, payouts_enabled, reliability, created_at)
skus     (id, category, title, platform, region, variant, aliases_json, ref_price_cents, image_url)
orders   (id, buyer_id, rules_text, rules_json, max_cents, status, expires_at, created_at)
order_skus (order_id, sku_id)                          -- index for matching
snaps    (id, seller_id, r2_key, sku_id, confidence, grade, grade_notes, flags_json, rack_cents, reserve_cents, created_at)
auctions (id, snap_id, status, started_at, ended_at, clearing_cents, winner_order_id, payment_intent_id, transfer_id)
bids     (auction_id, order_id, event, price_cents, reason, at)   -- event: join | drop | raise | win
```

Photos go in R2 (`snaps/{id}.jpg`). Live auction state lives in `AuctionDO` storage and is written to D1 when the auction ends. Match and valuation calls fan out through a Queue when there are more than about 5 candidates.

## Trust and safety

- **Shill bidding:** a seller can't bid on their own auction (checked by Telegram ID, Stripe customer and card fingerprint).
- **Wrong identification:** below a confidence threshold, the seller must pick from Claude's top 3 SKUs before the auction starts.
- **Reproductions:** a `reproduction` flag from grading blocks the auction.
- **Model output is advisory for money:** all amounts are capped in code by `max_cents` and `limit_cents`.

## Secrets (`wrangler secret put`, never commit)

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BRAINBASE_LABS_API_KEY`, `PRICECHARTING_API_KEY` (optional reference prices; otherwise Claude web search).

Endpoints that change state check a shared secret (Telegram header, Stripe signature, API key for Brainbase and MCP). No unauthenticated writes.

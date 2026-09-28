# Build plan

Four people in parallel. **Hard stop 3:30 PM PT. Final video take recorded by 2:45 PM PT.**

## Where we are

**Live:** https://go.snapflip.workers.dev (worker `go`; D1 `snapflip`, R2 `snapflip-photos`, Queue `snapflip-match` all provisioned; remote schema applied, demo seed is local-only). Pre-commit hook (gitleaks + eslint + tsc) is enforced — keep the tree green or it blocks your commit.

**Secrets: all required set.** `API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (bot @snapflipbot, webhook on prod), `STRIPE_SECRET_KEY` (**test** mode — webhook endpoint `we_1UKmWl…` created, `STRIPE_WEBHOOK_SECRET` set), `FEATHERLESS_API_KEY`. Boot guard passes and the guarded worker is deployed. Optional: `ANTHROPIC_API_KEY` (preferred primary when present). Still needed for the demo money shot: a **live** `sk_live_` Stripe key — the CLI only yields `sk_test_`.

**Model provider:** Anthropic → Featherless fallback in `claudeJson` (`lib/claude.ts`); every caller keys off `llmAvailable()`. Anti-spike stack shipped: `llm_cache` response cache in D1, Anthropic ephemeral prompt caching, 20s per-attempt timeout, verify fan-out capped at 5 concurrent calls.

- **A — Seller:** Telegram webhook + photo→R2→identify→grade→reserve→auction flow wired; `/a/{id}` live page and `/a/{id}/photo` image streaming done; low-confidence SKU picker shipped. Vision runs real calls through Featherless now — prompt tuning unblocked. Open: raise-max button (calls B's `/api/orders/:id/raise`), vision prompt tuning.
- **B — Engine:** Done pending live test — Claude rule parsing with code-enforced caps, deterministic valuation + model veto, soft-close + raise-your-max, fallback bidders now pay the same clearing price. Verified locally with seeded orders: 4-agent auction, staggered dropouts, correct winner/price.
- **C — Money:** Done pending live test — auth/capture/void/refund/transfer exercised end-to-end in stub mode. Stripe **test** key + webhook live on prod; Featherless fallback, response cache, timeouts, bounded verify fan-out all deployed. Remaining: live $1 run once a real `sk_live_` key lands; SPT deferred post-demo.
- **D — Buyer/GTM:** Per-buyer MCP tokens (`sf_…`, hash-stored; Bearer or `?token=`), `/api/buyers` concierge onboarding, `/buy` → connector URL flow, `/qr` + `/api/stats` for the booth — committed and verified locally (token auth incl. cross-buyer session rejection, limit check, `b_demo_*` excluded from stats). **Brainbase concierge provisioned:** `snapflip-concierge` agent created + secrets pushed (`concierge/` manifest in repo), `/api/buyers` contract verified on prod — blocked only on Brainbase account credits (`CREDITS_EXHAUSTED`) + enabling the Chat surface. **Uncommitted, untested:** MCP `raise_max` tool (dropouts rejoin via `buyerAgent.raise`), `create_standing_order` returns matched item titles; `/buy` polish — catalog chips, client + server validation that re-renders the form, optional per-grade caps (folded into rules text), orphaned-buyer cleanup, double-submit guard, `/buy/done` order summary; landing/`/qr` — cached QR, count-up animation, hidden-tab polling pause, demand bars (needs A's `layout.ts` redesign committed together). `DEMO.md` has the recruiting pitch, Brainbase API contract, Devpost + X drafts. Open: recruiting 15+ buyers, physical cartridges, filming.

**Demo buyers note:** seeded `b_demo_*` buyers have no token/card/Telegram — they can't win a real auction. `/api/stats` excludes them; keep it that way for "real numbers only."

## Decisions (defaults, change them now or never)

- Wedge: retro video games (Game Boy / N64 / SNES cartridges).
- Payments: **live mode** with small real amounts for the demo. Test mode stays deployed as a fallback.
- Payment limit: SPT if it works in the first hour, otherwise saved card charged off-session with the cap enforced in code.
- Seller interface: Telegram. Buyer interfaces: Claude via MCP, Brainbase concierge, `/buy` web page.
- No x402. One payment story, told well.

## Phase 0 — contracts (first 20 min, everyone together)

The scaffold in this repo already contains the contracts. Read them, change anything you disagree with *now*, then split up:

- `src/types.ts`: shared types (`Sku`, `Order`, `OrderRules`, `Snap`, `Grade`, `Valuation`, `AuctionView`, `BidEvent`, `NotifyEvent`, `Env`).
- The five handoff functions below. Each one starts as a stub in its owner's file, so everyone can build against it straight away.
- `schema.sql` / `seed.sql`, and `wrangler.jsonc` with D1, R2, Queue and DO bindings.

### Handoff functions

| Function | Called by → owned by | File |
|---|---|---|
| `startAuction(env, snap, reserveCents) → {auctionId}` | A → B | `src/auction.ts` |
| `settleAuction(env, auctionId, ranked[]) → {ok, orderId, paymentIntentId}` | B → C | `src/payments.ts` |
| `capture(env, auctionId)` / `release(env, auctionId)` | A → C | `src/payments.ts` |
| `notify(env, to, event)` | B, C → A | `src/telegram.ts` |
| `POST /api/orders {buyerId, rulesText, maxCents} → Order` | D → B | `src/orders.ts` |

Swap a stub for the real implementation without changing its signature. If you must change a signature, say so in the team chat before merging.

## Workstreams

| Dev | Owns | Files |
|---|---|---|
| **A — Seller** | Telegram bot, vision, reserve → start auction, confirm/ship buttons, all notifications, live `/a/{id}` page | `telegram.ts`, `vision.ts`, `web/auction.ts` |
| **B — Engine** | Order rule parsing, matching + valuation, `AuctionDO`, `BuyerAgent` | `orders.ts`, `match.ts`, `auction.ts`, `buyer.ts` |
| **C — Money** | Payment limits, authorize/capture/cancel with fallback, Connect, webhook, schema + seed, **sole deployer** | `payments.ts`, `stripe-webhook.ts`, `schema.sql`, `seed.sql`, `wrangler.jsonc` |
| **D — Buyer + go-to-market** | MCP server, Brainbase concierge, `/buy` and landing pages, recruiting, physical items, video, Devpost | `mcp.ts`, `web/landing.ts`, `web/buy.ts`, `DEMO.md` |

### A — Seller
- Telegram: photo → R2 → `identify` + `grade` → "Matched 4 standing orders. Set your rack price." → reserve → `startAuction`.
- `notify()` for every buyer/seller message. Live auction updates by editing the Telegram message, or linking to `/a/{id}`.
- `/a/{id}` page: subscribes to `/a/{id}/ws` and renders the price ticker and dropouts.
- Confirm purchase (photo) → `capture`. Shipped button. Low-confidence path: pick from the top 3 SKUs.
- **Done when:** a real cartridge photo returns the right SKU and a sensible grade 5 times in a row.

### B — Engine
- `/api/orders`: Claude parses rules into `rules_json`; also writes `order_skus`.
- `match.ts`: candidates by SKU, then a Claude valuation per order, **capped in code** by `max_cents` and the buyer's `limit_cents`.
- `AuctionDO`: alarm clock, dropouts, soft close, WebSocket broadcast, result to D1, then `settleAuction`.
- `BuyerAgent`: raise-max handling, per-buyer state.
- Test with `fixtures/valuations.json` (no photos needed).
- **Done when:** 5 seeded agents run a full auction from a fake snap, with the correct winner and price.

### C — Money
- `/buy/setup` → payment limit stored. Try SPT first, time-boxed to 45 min.
- `settleAuction`: manual-capture PaymentIntent, off-session; try the next ranked bidder if it fails.
- `capture` on confirm, `release` (Transfer) on delivered, Connect Express onboarding at `/sell/onboard`.
- `/webhooks/stripe` with signature check. Test with `stripe listen --forward-to localhost:8787/webhooks/stripe`.
- Create D1/R2/Queue resources, own `wrangler deploy`.
- **Done when:** a real $1 end-to-end run works in live mode: authorize → capture → transfer shows in the Dashboard.

### D — Buyer + go-to-market
- MCP server first (quick, and it unblocks recruiting): tools call the same logic as `/api/orders`.
- Brainbase concierge agent: `snapflip-concierge` provisioned (`concierge/` manifest, secrets pushed). Needs account credits + Chat surface enabled.
- Landing page: live "$X of standing demand across N collectors" from `/api/orderbook`, plus a QR code to `/buy`.
- **Recruit real buyers onsite:** goal 15+ attendees with standing orders and payment limits, including at least one judge if allowed.
- Get physical items (thrift or local game store run, or teammates' own cartridges) and record the real rack price.
- Own `DEMO.md`: script, shots, filming, editing, upload, Devpost, X post.

**Critical path:** A's vision identifying cartridges reliably, and B's `AuctionDO` running. If either is behind at +75 min, D pauses recruiting to help. The Brainbase concierge is the first thing to drop.

## Repo conventions

- **Sub-routers:** each file exports a Hono router, and `src/index.ts` only mounts them. Don't put routes in `index.ts`.
- **Git:** small PRs to `main` at least every 45 min. No long-lived branches. Pull before you start each block.
- **Local dev:** `npm run dev` (local D1/R2). Apply the schema locally with `npm run db:local`. Copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill in your own keys.
- **Telegram:** each dev makes their own test bot with BotFather. Expose local dev with `cloudflared tunnel --url http://localhost:8787`, then run `npm run tg:webhook -- <tunnel-url>`.
- **Deploys:** only C runs `npm run deploy`, from `main`. Shared secrets are set once with `wrangler secret put`.
- **Before pushing:** `npm run check` (typecheck and a wrangler dry-run build) must pass.

## Integration milestones

| When | Milestone | Status |
|---|---|---|
| +20 min | Contracts committed, empty Worker deployed | ✅ contracts; worker live at go.snapflip.workers.dev |
| +75 min | A: snap → SKU + grade. B: auction runs on seeded data. C: payment limit saved. | ✅ B (seeded auction runs); ✅ C (limit stored at signup); ✅ A (flow wired; vision live via Featherless) |
| +105 min | **Full loop in test mode:** snap → auction → authorize → capture → Telegram pings | 🟡 stub-mode loop verified; Stripe test key + webhook live — needs one real Telegram snap to close |
| +120 min | Live mode $1 run. **Record backup take.** | ⬜ blocked on `sk_live_` key (CLI only yields test keys) |
| 2:45 PM | Final take recorded | ⬜ |
| 3:15 PM | Devpost submitted (edit until 3:30) | ⬜ |

## Cut order if behind

1. Soft close / human raise-max
2. Shipping and delivery → Transfer (show capture only; say transfer-on-delivery is next)
3. Brainbase concierge (MCP and web still create orders)
4. SPT (use saved card)
5. Low-confidence SKU picker (demo with items that identify reliably)

**Never cut:** live auction with at least 3 agents, real payment authorized and captured, real onsite buyers, team on camera.

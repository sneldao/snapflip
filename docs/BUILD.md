# Build plan

Four people in parallel. **Hard stop 3:30 PM PT. Final video take recorded by 2:45 PM PT.**

## Where we are

**Live:** https://go.snapflip.workers.dev (worker `go`; D1 `snapflip`, R2 `snapflip-photos`, Queue `snapflip-match` all provisioned; remote schema applied, demo seed is local-only). Pre-commit hook (gitleaks + eslint + tsc) is enforced — keep the tree green or it blocks your commit.

**Secrets: all required set.** `API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (bot @snapflipbot, webhook on prod), `STRIPE_SECRET_KEY` (**test** mode — webhook endpoint `we_1UKmWl…` created, `STRIPE_WEBHOOK_SECRET` set), `FEATHERLESS_API_KEY`. Boot guard passes and the guarded worker is deployed. Optional: `ANTHROPIC_API_KEY` (preferred primary when present). Still needed for the demo money shot: a **live** `sk_live_` Stripe key — the CLI only yields `sk_test_`.

**Model provider:** Anthropic → Featherless fallback in `claudeJson` (`lib/claude.ts`); every caller keys off `llmAvailable()`. Anti-spike stack shipped: `llm_cache` response cache in D1, Anthropic ephemeral prompt caching, 20s per-attempt timeout, verify fan-out capped at 5 concurrent calls.

- **A — Seller:** Telegram webhook + photo→R2→identify→grade→reserve→auction flow wired; `/a/{id}` live page and `/a/{id}/photo` image streaming done; low-confidence SKU picker shipped. Vision runs real calls through Featherless now — prompt tuning unblocked. Raise-max button shipped: the dropout ping carries a "Raise max to $X and rejoin" button whose `raise:` callback goes through `BuyerAgent.raise` (payment-limit capped, same as `/api/orders/:id/raise`). Open: vision prompt tuning.
- **B — Engine:** Done pending live test — Claude rule parsing with code-enforced caps, deterministic valuation + model veto, soft-close + raise-your-max, fallback bidders now pay the same clearing price. Verified locally with seeded orders: 4-agent auction, staggered dropouts, correct winner/price.
- **C — Money:** Done pending live test — auth/capture/void/refund/transfer exercised end-to-end in stub mode. Stripe **test** key + webhook live on prod; Featherless fallback, response cache, timeouts, bounded verify fan-out all deployed. Remaining: live $1 run once a real `sk_live_` key lands; SPT deferred post-demo.
- **D — Buyer/GTM:** Per-buyer MCP tokens (`sf_…`, hash-stored; Bearer or `?token=`), `/api/buyers` concierge onboarding, `/buy` → connector URL flow, `/qr` + `/api/stats` for the booth — committed and verified locally (token auth incl. cross-buyer session rejection, limit check, `b_demo_*` excluded from stats). **Brainbase concierge provisioned:** `snapflip-concierge` agent created + secrets pushed (`concierge/` manifest in repo), `/api/buyers` contract verified on prod — blocked only on Brainbase account credits (`CREDITS_EXHAUSTED`) + enabling the Chat surface. **Committed; check + lint green:** MCP `raise_max` tool (dropouts rejoin via `buyerAgent.raise`), `create_standing_order` returns matched item titles; `/buy` polish — catalog chips, client + server validation that re-renders the form, optional per-grade caps (folded into rules text), orphaned-buyer cleanup, double-submit guard, `/buy/done` order summary gated to the session buyer; `/buy/orders` list + cancel pages. **Committed:** landing/`/qr` phosphor redesign + brand pass — auto-playing "simulated tape" hero, live auction tape of real sales, how-it-works steps, cached QR, count-up animation, hidden-tab polling pause, demand bars; shared `> snapflip▊` wordmark, favicon, `theme-color`; `/a/{id}` auto-reconnects its WebSocket (snapshot on accept). **Uncommitted, lint+check green:** Konami turbo mode, `/api/stats.recent` real-auction tape, thrift price-tag on the demand figure, INSERT-COIN attract on `/qr`, `/buy/done` till-receipt order card (barcode keyed to order id, empty-orders fallback). **D also did the `/a/{id}` money-shot polish** (A's file, video-critical): polaroid snap photo, shutter flash, pixel-bot agent chips that grey out with drop reasons, segmented boss-bar countdown (green→amber→red), GOING ONCE/TWICE/FINAL CALL on soft-close + SOLD/LEFT-ON-THE-RACK verdict banner — uses a new additive `closing` flag on `AuctionView` (types.ts) + one line in `auction.ts` `view()`. `DEMO.md` has the 2:00 inverted-cold-open script, the recruiting pitch, Brainbase API contract, Devpost + X drafts. Open: recruiting 15+ buyers, physical cartridges, filming.

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
- `capture` on confirm, `release` (Transfer with `source_transaction`) on delivered, Connect onboarding at `/sell/onboard` (Accounts v2 recipients — Stripe policy-blocks v1 Express creation).
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

## Landing page — design principles and next step

**Principles we design against** (from the UI/UX review): *chunking* (group information the way users think, not the way we built it), *visual hierarchy* (not everything gets the same weight), and *progressive disclosure* per [Primer](https://github.com/primer/design/blob/main/content/ui-patterns/progressive-disclosure.mdx) (use it sparingly, never hide what the user came for, always pair the toggle icon with text) and [North](https://github.com/north/north) (complexity is fine, complication isn't; high signal-to-noise; consistent, predictable components; don't hide content by device).

**Shipped** (`src/web/landing.ts`, `src/web/layout.ts`):
- Six sections instead of ~14: hero (order form inline) → demo → live order book → guardrails → FAQ → closing "two doors" CTA. The scroll tour is a footer link.
- Chunking: the demo explains itself in three synced beats (**snap · bid · sold**); the raw agent log and the money breakdown sit behind labelled toggles.
- Hierarchy: the hero and demo are the only framed cards; the order book, guardrails (full-width footage band) and FAQ drop card chrome, so evidence reads lighter than the story.
- Consistency: one primary (filled green) and one secondary (amber outline) button style, and one chevron + label disclosure style, shared by every page from `layout.ts`.
- Archival footage backdrops (public-domain Moving Image Archive clips in `public/media`, served by the Worker with byte ranges so iOS Safari plays them): lazy-loaded, paused off-screen, stills only for reduced motion / data saver.

**Next — audience switch in the hero (after Brainbase judging).** The page still speaks to collectors first, with resellers a link away. Add an **I collect | I resell** segmented switch at the top of the hero that swaps the headline, one-line explanation, primary action and three beats to match the visitor:

| | I collect (default) | I resell |
|---|---|---|
| Headline | Tell an agent what you're hunting. It wins it for you. | Know it's sold before you pay. |
| Explanation | Set your max once; your agent bids on every matching snap and never goes a dollar over. | Snap a cart on the rack; buyer agents bid for 60 seconds; buy it only if it cleared your floor. |
| Primary action | Order form (item + max → Start hunting) | Open the Telegram bot (amber button) |
| Beats | Set · Bid · Win | Snap · Watch · Decide |

Rules: one control, two states, no page change (Primer: maintain context). Remember the choice (URL `?as=resell` for shareable links, plus `localStorage`). Collector stays the default so the booth QR flow is unchanged. Everything below the hero stays shared. Colour follows the existing system: green = collectors, amber = resellers.

**Decision: `/sell` stays a long-form page, no redirect.** The hero switch orients ("is this for me, what do I tap?"); `/sell` answers what a reseller needs before committing (what they net, payout timing, express payout, the one-time Stripe setup). Redirecting would either drop that depth or cram it into the hero, and it would break `/sell` as a shareable destination with its own share card. To keep the two cohesive:
1. One shared set of reseller copy (headline, explanation, beats) used by both the hero's "I resell" state and the top of `/sell`, so they can't drift.
2. The hero's reseller state shows only the essentials (headline, one line, the Telegram button) plus a "How it pays →" link to `/sell`.
3. `/sell` opens with the same hero in the "I resell" state, detail below; flipping the switch to "I collect" there goes to `/`.
4. `?as=resell` is a shortcut to the landing page in reseller state (booth / social links); `/sell` stays the canonical reseller URL.
5. Guardrail: `/sell/onboard` (Stripe payout setup) shares the prefix. Any future redirect must match `/sell` exactly, never the onboarding path.

Done when both hero states and `/sell` pass the desktop + mobile screenshot check.

## Cut order if behind

1. Soft close / human raise-max
2. Shipping and delivery → Transfer (show capture only; say transfer-on-delivery is next)
3. Brainbase concierge (MCP and web still create orders)
4. SPT (use saved card)
5. Low-confidence SKU picker (demo with items that identify reliably)

**Never cut:** live auction with at least 3 agents, real payment authorized and captured, real onsite buyers, team on camera.

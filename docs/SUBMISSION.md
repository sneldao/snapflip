# Devpost submission — copy-paste ready

Track: **Agentic Payments**. Fill `<>` placeholders from `/api/stats` and the final take before submitting. Deadline 3:15 PM (edit until 3:30).

## Project name

SnapFlip

## Tagline

Sold before you buy it — AI buyer agents bid on your thrift find while it's still on the rack.

## Elevator pitch (short description field)

SnapFlip is an order book for secondhand goods. Collectors tell an agent what they want and the most they'd pay. A reseller photographs a cartridge at a thrift store; a vision model identifies the exact SKU and grades its condition; every matching buyer agent enters a 60-second live auction on the spot. The seller sees the clearing price *before* paying for the item — then the winner's card is charged for real.

## Inspiration

Resellers carry all the risk: they buy inventory on a hunch, spend time listing it, and hope someone buys. Collectors know exactly what they'd pay but have to refresh marketplaces all day. We wanted the moment of discovery — a cartridge in a thrift-store bin — to meet the demand that already exists for it, instantly.

## What it does

- A collector sets a standing order in plain English: *"Pokémon Yellow, cartridge only, authentic, good label, up to $45."* They can do it through Claude (via our remote MCP server), a Brainbase-hosted concierge agent, or a web page — and they grant a capped, expiring spending limit.
- A reseller snaps a photo in Telegram. A vision model identifies the exact SKU and grades the cartridge's condition (A–D, with condition flags).
- Every buyer agent whose standing order matches enters a 60-second ascending-clock auction. Each agent drops out at its buyer's true value *for this item at this grade* — and tells the buyer why ("grade B, capped at $32").
- The seller watches the price climb live, sees what they'd net, and only then decides to buy. One tap confirms; the winner's card is captured. Payout releases to the seller via Stripe Connect on delivery.
- If nothing clears the reserve, the seller walks away having lost nothing.

## How we built it

A single Cloudflare Worker is the backbone:

- **Anthropic Claude** (vision + text): SKU identification, condition grading, parsing plain-English order rules into structured constraints, and per-order auction valuation. An OpenAI-compatible fallback provider (Featherless) keeps the pipeline alive if the primary API is unavailable; model responses are cached in D1 so retries and re-sends cost nothing.
- **Cloudflare**: Durable Objects — one per live auction (alarm-driven clock, hibernatable WebSockets for the live bid feed) and one per buyer agent — plus D1 for the order book, R2 for photos, Queues for match jobs, cron for sweeping stale payment holds, and a remote MCP server collectors attach to Claude.
- **Stripe**: saved-card setup with a code-enforced spending limit, off-session PaymentIntents with manual capture, full lifecycle (capture on seller confirm, void on timeout, refund pre-transfer, Connect Express transfer on delivery), and a signature-verified webhook that reconciles state.
- **Brainbase**: a hosted concierge agent (`snapflip-concierge`) that onboards collectors in chat and registers orders through our API.

## Agentic payments (why this track)

The agents aren't advising — they commit real money autonomously, inside limits a human set. Every amount a model suggests is capped in code by the order max *and* the payment limit; the model can veto or lower a bid, never raise it. Authorization is manual-capture and only captured after the seller confirms the item. A buyer whose agent is losing can raise their cap from Telegram — a human override, always bounded by the payment limit.

## The business case

**The mechanism is proven — twice.** StockX is a standing-bid order book for sneakers (~$3.8B valuation; our "standing order" is their "Bid"). Whatnot turned live auctions into $8B of 2025 GMV at a ~12.5% effective take (~$1B revenue). SnapFlip fuses both: standing demand + live auction — but executes at *the point of discovery*, the thrift rack, before money changes hands. That's the part neither incumbent does.

**Market.** Retro game collectibles: ~$4B and compounding ~10%/yr toward ~$8.5B by 2033 — dense with exact SKUs and condition-graded pricing, ideal for agents. The wedge generalizes to anything with a canonical identity — vinyl pressings, LEGO set numbers, TCG cards are catalog rows, not rebuilds. Behind it: US online resale doubling to ~$40B by 2029, inside a $367B global secondhand market.

**Take rate:** 10% seller fee on the clearing price — below eBay's ~13.6% collectibles FVF and Whatnot's ~12.5% effective take, without eBay's listing labor or Whatnot's showtime scheduling. Sellers accept it because the item is *already sold* — the fee buys certainty, not exposure.

**Unit economics on a representative $38 cart:**

| Line | Amount |
|---|---|
| Clearing price | $38.00 |
| SnapFlip fee (10%) | $3.80 |
| Stripe charge (2.9% + $0.30) | −$1.40 |
| Model calls (identify + grade + ~5 verifications, cached/capped) | −$0.05 |
| Cloudflare infra (Workers/DO/D1/R2) | −$0.01 |
| **Contribution per order** | **≈ $2.35 (~62% margin)** |

The flat $0.30 processing fee is the enemy at low price points — Whatnot's own schedule shows effective take climbing as orders shrink, so we floor viable carts around ~$10 (or bundle multi-cart snaps). Buyer subscription (priority matching, alert windows) and real-time demand data are the expansion revenue.

**Honest risks:** two-sided cold start (mitigated in the wedge by recruiting collectors first — demand is portable, supply walks around thrift stores), catalog/SKU coverage limits matching, authentication escalates with item value (repro flagging helps, graded markets need more), and take-rate compression is a real trend (TikTok Shop pushes ~6%).

## What we built today

_`<N>` collectors, `$<X>` in standing demand, `<Y>` real transactions — live at go.snapflip.workers.dev (numbers are real; demo data is excluded from stats)._

## Challenges

- **Trusting a model with money.** Solved by splitting authority: deterministic code computes the hard cap; the model can only veto or lower. A bad model response can never over-spend.
- **Real payment lifecycle in a day.** Authorization without capture is a hold, not a charge — we handle confirm, void-on-timeout, refund, and Connect transfer as distinct states, reconciled by webhook.
- **Provider resilience.** Model calls go through a provider chain with timeouts and a request-hash cache, so an API hiccup degrades gracefully instead of killing the demo.

## Accomplishments we're proud of

- A real transaction — real buyer, real card, real cartridge — cleared by agents in under 60 seconds.
- Three independent buyer surfaces (MCP connector, hosted concierge, web) all writing the same order book.
- The auction is watchable: a live WebSocket tape with per-agent dropout reasons.

## What's next

More exact-identity collectibles (vinyl pressings, LEGO sets, TCG — a catalog migration, not a rebuild), transfer-on-delivery with tracking, Shared Payment Tokens for buyer limits, sneakers once authentication exists.

## Built with

Anthropic Claude, Cloudflare Workers, Cloudflare Durable Objects, Cloudflare Agents SDK, Cloudflare D1, Cloudflare R2, Cloudflare Queues, Stripe (PaymentIntents, manual capture, Connect Express, webhooks), Brainbase (hosted agent concierge), Featherless (fallback inference), Telegram Bot API, Hono, TypeScript.

## Links

- Live: https://go.snapflip.workers.dev (buyer onboarding: /buy, booth display: /qr, Claude connector: /mcp)
- Repo: https://github.com/sneldao/snapflip
- Video: `<unlisted YouTube URL>`

## Checklist

- [ ] YouTube upload (unlisted fine)
- [ ] Devpost fields above filled, real numbers pulled from `/api/stats` right before submit
- [ ] All 4 teammates added on Devpost
- [ ] X post tagging @BrainbaseHQ + short clip of the auction ticker — **required for prize eligibility**
- [ ] Repo public

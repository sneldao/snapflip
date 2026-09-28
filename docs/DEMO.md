# Demo video (2:30 target, 3:00 hard max)

The story: **two humans, several agents, one real transaction, under 60 seconds, one take.**

## Script

| Time | Shot | Line / content |
|---|---|---|
| 0:00–0:08 | Phone-shot cold open: hand pulls a cartridge from a bin, snaps it | "This is $6. Before I pay for it, I want to know it's already sold." |
| 0:08–0:25 | Team on camera, 4 faces | Problem in one breath: resellers buy blind, collectors refresh marketplaces all day. "SnapFlip lets buyer agents bid on your find while it's still on the rack." |
| 0:25–0:40 | Buyer side: a real attendee on camera tells Claude their order | "Pokémon Yellow, authentic label, up to $45." Show the MCP tool call and the payment-limit confirmation. |
| 0:40–1:35 | **Main shot, one continuous take, speedrun timer on screen.** Split screen: seller phone and live `/a/{id}` page | Snap → "Matched 5 orders" → reserve $10 → price climbs, agents drop out with reasons ("grade B, capped at $32") → cleared at $38 → seller taps "Bought it" |
| 1:35–1:55 | Buyer's phone buzzes, cut to their face | "Your agent won Pokémon Yellow for $38." Stripe Dashboard: live payment captured. |
| 1:55–2:10 | Landing page | "Built today: N collectors, $X in standing demand, Y real transactions." Real numbers only. |
| 2:10–2:25 | Team on camera | Honesty: what's real (live payments, real buyers, Claude grading) and what's next (shipping labels, transfer-on-delivery, sneakers with authentication). |
| 2:25–2:30 | Logo + URL | |

## Rules

- **Timer on screen** for the main shot. Jump cuts are fine while Claude thinks, but the timer keeps running so every cut is visible.
- **Real money, real people.** The buyer in the main shot is a real attendee with their own card, not a teammate.
- **No slides, no architecture diagram.** The stack goes in the Devpost write-up.
- **Numbers on screen must be real,** pulled from the live `/api/orderbook`.

## Prep checklist

- [ ] 3–5 cartridges that identify reliably (tested 5× each)
- [ ] At least 5 standing orders matching the hero item, with different grade caps so dropouts are staggered and readable
- [ ] Hero buyer briefed, with their Telegram linked and a payment limit set
- [ ] Phone mirrored with QuickTime; screen recorded at 1080p; lapel mic or quiet room
- [ ] **Backup take recorded as soon as the loop works (+120 min)**
- [ ] Test-mode deployment ready in case live mode breaks

## Recruiting onsite (owner: D)

Goal: 15+ attendees with a standing order and a saved card, including at least one judge if allowed. Put `/qr` full-screen on a laptop at the table; every signup shows up live on `/` and `/qr` (seeded `b_demo_*` buyers are excluded, so the numbers are real).

**30-second pitch:** "Name a retro game you'd actually buy and the most you'd pay. Your agent bids for you when one of us finds it at a thrift store today. You're only charged if it wins, never above your max, and usually less. Scan here, it takes a minute."

- Hand them the list of matchable titles (shown on `/buy`). Orders that don't name a catalog item are rejected.
- Nudge them to phrase conditions ("B or better", "$30 if the label is worn") so dropouts on camera are varied.
- Claude users: after checkout, `/buy/done` shows a personal connector URL. Claude.ai: Settings → Connectors → Add custom connector. That URL is a password; tell them not to screenshot it publicly.
- Pick the hero buyer early: has Telegram, is happy on camera, sets an order on the hero item.

## Brainbase concierge (drop first if behind)

Our side is ready: the concierge calls `POST /api/buyers` (`{name, email?, limitCents}`, `Authorization: Bearer $API_KEY`) → `{buyerId, mcpUrl, setupUrl, telegramUrl}`, sends the user `setupUrl` to save a card, then `POST /api/orders` (`{buyerId, rulesText, maxCents}`). Confirm at the Brainbase booth how a chat-deployment flow makes outbound HTTP calls with a secret header.

## Devpost draft

**SnapFlip: sold before you buy it.** An order book for secondhand goods where AI agents bid on a thrift find while it's still on the rack.

- **Problem:** resellers buy inventory on a hunch and hope it sells; collectors know exactly what they'd pay but refresh marketplaces all day.
- **How it works:** collectors set standing orders in plain English through Claude (MCP), a Brainbase concierge or the web, with a capped spending limit. A reseller snaps an item on Telegram; Claude identifies the exact SKU and grades condition. A 60-second ascending-clock auction runs among every matching buyer agent, and each drops out at what its buyer would pay for *this* item at *this* grade. The seller sees the clearing price before paying for the item, buys it, confirms with a photo, and the buyer's card is captured.
- **Built today:** _N_ real collectors, _$X_ in standing demand, _Y_ real transactions (copy from `/api/stats` at submission time).
- **Agentic payments:** agents commit real money on their own, within limits their human set. Every amount the model suggests is capped in code by the order max and the payment limit. Authorization is manual-capture and only captured once the seller has the item.
- **Stack:** Anthropic (vision identify + grade, rule parsing, per-order valuation), Cloudflare (Workers, Durable Objects per auction and per buyer agent, remote MCP server, D1, R2, Queues), Stripe (saved-card limits, manual capture, Connect Express payouts via separate charges and transfers), Brainbase (hosted buyer concierge).
- **What's next:** shipping labels and transfer-on-delivery, Shared Payment Tokens, vinyl/LEGO, sneakers once authentication exists.

## X post draft

> Snapped a $6 Game Boy cart at a thrift store. 40 seconds later, 5 AI buyer agents had bid it up to $38, and a real collector's card was charged. Sold before I paid for it. Built today at the Startup Speedrun with @BrainbaseHQ @AnthropicAI @Cloudflare @stripe [clip] [URL]

Fill in the real numbers from the final take before posting.

## Submission (owner: D)

- [ ] YouTube upload (unlisted is fine)
- [ ] Devpost: what, problem, how it works, what we built today, what's next, stack with all 4 sponsors and how each is used, track: Agentic Payments
- [ ] Public repo link, live URL
- [ ] X post tagging @BrainbaseHQ (short clip of the auction ticker plus the URL). **Required for prize eligibility.**
- [ ] All 4 teammates added on Devpost

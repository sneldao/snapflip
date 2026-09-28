# Demo video (2:00 target)

The story: **two humans, several agents, one real transaction, under 60 seconds — told backwards.** Open on the impossible result, rewind, replay it in real time.

## Script

| Time | Shot | Line / content |
|---|---|---|
| 0:00–0:06 | **Inverted cold open.** Black → Telegram ding → phone at the thrift rack showing `SOLD — $38` | "This cart isn't listed anywhere. Nobody negotiated. It just sold — and I haven't paid for it yet." |
| 0:06–0:10 | **Rewind beat.** Speedrun timer snaps back to 0:00 over the same footage | "Here's what happened in the last 60 seconds." |
| 0:10–0:20 | Bin-digging b-roll, fast cuts (~3s each) | Problem in one breath: resellers buy blind; collectors know exactly what they'd pay but refresh marketplaces all day. |
| 0:20–0:35 | Buyer side: real attendee tells Claude their order | "Pokémon Yellow, up to $45, B grade or better." → MCP tool call → `/buy/done` receipt (the mandate is the prop). |
| 0:35–1:25 | **The money shot.** Split screen: rack photo left, `/a/{id}` fullscreen right, timer overlay running | Snap → identified + graded → agents join → price climbs, agents drop *with visible reasons* → cleared at $38 → seller taps "I bought it". |
| 1:25–1:40 | Winner's phone buzzes; **show their face reacting** | "Their agent won at $38 — they'd capped it at $45." Then Stripe dashboard, live capture visible. |
| 1:40–1:52 | Landing page `/`, stats counting up live | "Every number on this screen is real — N collectors, $X standing demand, Y transactions — today, at this event." |
| 1:52–2:00 | `> snapflip▊` wordmark + `go.snapflip.workers.dev` + **the QR on the final frame** | "Sold before you buy it." Judges can scan the buy page while they deliberate. |

## Engagement devices

- **Captions on everything** — most judges watch muted. Big, high-contrast, karaoke-timed.
- **Diegetic sound:** real thrift-store ambience, shutter click at SNAP, a tick per price step synced to the music's beat, register ca-ching at SOLD. All added in the edit; the app doesn't need to make noise.
- **One sentence of VO per shot.** If a line needs two breaths, it's two shots.
- **The timer is the honesty device:** it keeps running through every jump cut — "we cut the boring parts" becomes a flex, not a fib.
- **The receipt is the agentic-money prop.** `/buy/done` prints a till receipt with a barcode — the buyer literally holding a printed mandate.

## Rules

- **Timer on screen** for the main shot. Jump cuts are fine while Claude thinks, but the timer keeps running so every cut is visible.
- **Real money, real people.** The buyer in the main shot is a real attendee with their own card, not a teammate.
- **No slides, no architecture diagram.** The stack goes in the Devpost write-up.
- **Numbers on screen must be real,** pulled from the live `/api/orderbook`.

## Risk management

- Record the **backup take the moment the loop works**, not on filming day.
- If live Stripe flakes on the day: the `/buy/done` receipt + Telegram win ping carry the "real money" claim without a dashboard shot.
- Hero buyer briefed, Telegram linked, card already through `/buy/setup` — **no form-filling on camera**.
- The SOLD-notification frame needed for the cold open is easiest shot *first*: screen-cap the bot message, film it on the rack.

## Prep checklist

- [ ] 3–5 cartridges that identify reliably (tested 5× each)
- [ ] At least 5 standing orders matching the hero item, with different grade caps so dropouts are staggered and readable
- [ ] Hero buyer briefed, with their Telegram linked and a payment limit set
- [ ] Phone mirrored with QuickTime; screen recorded at 1080p; lapel mic or quiet room
- [ ] Captions + sound design pass scheduled in the edit (ticks synced to music)
- [ ] **Backup take recorded as soon as the loop works (+120 min)**
- [ ] Test-mode deployment ready in case live mode breaks

## Recruiting onsite (owner: D)

Goal: 15+ attendees with a standing order and a saved card, including at least one judge if allowed. Put `/qr` full-screen on a laptop at the table; every signup shows up live on `/` and `/qr` (seeded `b_demo_*` buyers are excluded, so the numbers are real).

**30-second pitch:** "Name a retro game you'd actually buy and the most you'd pay. Your agent bids for you when one of us finds it at a thrift store today. You're only charged if it wins, never above your max, and usually less. Scan here, it takes a minute."

- Hand them the list of matchable titles (shown on `/buy`). Orders that don't name a catalog item are rejected.
- Nudge them to phrase conditions ("B or better", "$30 if the label is worn") — or use the grade-cap fields on `/buy` — so dropouts on camera are varied.
- Claude users: after checkout, `/buy/done` shows a personal connector URL. Claude.ai: Settings → Connectors → Add custom connector. That URL is a password; tell them not to screenshot it publicly.
- Pick the hero buyer early: has Telegram, is happy on camera, sets an order on the hero item.

## Brainbase concierge (drop first if behind)

Live: `snapflip-concierge` agent (`b3ff7b7f`) created via `brainbase` CLI under Papa Jams's Team — manifest + instructions in `concierge/`, pushed to the cloud agent. The agent calls `POST /api/buyers` (`{name, email?, limitCents}`, `Authorization: Bearer $API_KEY` from its secrets store) → `{buyerId, mcpUrl, setupUrl, telegramUrl}`, sends the user `setupUrl` to save a card, then `POST /api/orders` (`{buyerId, rulesText, maxCents}`). The old open question is answered: the claude-code harness sandbox gets secrets via `.brainbase/secrets.env` and can `curl` outbound. Blocked only by account credits (CREDITS_EXHAUSTED) — add credits on their Billing page or claim hackathon credits at the booth, then enable the Chat surface.

## Devpost draft

Full copy-paste-ready submission lives in [`docs/SUBMISSION.md`](SUBMISSION.md) — project name, tagline, story fields, built-with list, links, checklist.

## X post draft

> Snapped a $6 Game Boy cart at a thrift store. 40 seconds later, 5 AI buyer agents had bid it up to $38, and a real collector's card was charged. Sold before I paid for it. Built today at the Startup Speedrun with @BrainbaseHQ @AnthropicAI @Cloudflare @stripe [clip] [URL]

Fill in the real numbers from the final take before posting.

## Submission (owner: D)

- [ ] YouTube upload (unlisted is fine)
- [ ] Devpost: what, problem, how it works, what we built today, what's next, stack with all 4 sponsors and how each is used, track: Agentic Payments
- [ ] Public repo link, live URL
- [ ] X post tagging @BrainbaseHQ (short clip of the auction ticker plus the URL). **Required for prize eligibility.**
- [ ] All 4 teammates added on Devpost

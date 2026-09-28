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

## Submission (owner: D)

- [ ] YouTube upload (unlisted is fine)
- [ ] Devpost: what, problem, how it works, what we built today, what's next, stack with all 4 sponsors and how each is used, track: Agentic Payments
- [ ] Public repo link, live URL
- [ ] X post tagging @BrainbaseHQ (short clip of the auction ticker plus the URL). **Required for prize eligibility.**
- [ ] All 4 teammates added on Devpost

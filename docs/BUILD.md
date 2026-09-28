# Build plan

Four people in parallel. **Hard stop 3:30 PM PT. Final video take recorded by 2:45 PM PT.**

## Decisions (defaults, change them now or never)

- Wedge: retro video games (Game Boy / N64 / SNES cartridges).
- Payments: **live mode** with small real amounts for the demo. Test mode stays deployed as a fallback.
- Payment limit: SPT if it works in the first hour, otherwise saved card charged off-session with the cap enforced in code.
- Seller interface: Telegram. Buyer interfaces: Claude via MCP, Brainbase concierge, `/buy` web page.
- No x402. One payment story, told well.

## Phase 0 — contracts (first 20 min, everyone together)

Agree on these, commit them, then split up:

- `schema.sql` (from ARCHITECTURE.md) and `src/types.ts`: `Sku`, `Order`, `OrderRules`, `Snap`, `Grade`, `AuctionState`, `BidEvent`, `Valuation`.
- `AuctionDO` interface: `start(snapId, candidates: Valuation[], reserveCents)`, `raise(orderId, newMaxCents)`, WebSocket message shape `{type, priceCents, active, dropped[], endsAt}`.
- One `wrangler.jsonc` with D1, R2, Queue, DO bindings. Deployed empty to `*.workers.dev` so everyone deploys to the same place.
- Seed data: 30 SKUs for the games we can physically get today, with reference prices.

## Workstreams

### A — Seller intake and vision
- Telegram bot: photo → R2 → `identify` + `grade` → "Matched 4 standing orders. Set your rack price." → reserve → start auction.
- Live auction message: edit the Telegram message on each tick (or link to `/a/{id}`).
- Confirm purchase (photo) and shipped buttons.
- Low-confidence path: pick from top 3 SKUs.
- **Done when:** a real cartridge photo returns the right SKU and a sensible grade 5 times in a row.

### B — Order book, buyer agents, auction engine
- `/api/orders` with Claude rule parsing → `rules_json`.
- `match.ts`: candidates by SKU, then Claude valuation per order, capped in code.
- `AuctionDO`: alarm clock, dropouts, soft close, result to D1, WebSocket fan-out.
- `BuyerAgent`: notifications, raise-max replies.
- MCP server with buyer tools. Test from Claude.
- **Done when:** 5 seeded agents run a full auction from a fake snap, with the correct winner and price.

### C — Payments
- `/buy/setup` → payment limit stored. Try SPT first, time-boxed to 45 min.
- On clear: manual-capture PaymentIntent; fallback to the next bidder if it fails.
- Capture on confirm, Transfer on delivered, Connect Express onboarding for sellers.
- Stripe webhook handler with signature check.
- **Done when:** a real $1 end-to-end run works in live mode: authorize → capture → transfer shows in the Dashboard.

### D — Go-to-market, demo, and Brainbase
- Brainbase concierge worker: chat → `/api/orders`. Go to their booth first to confirm the integration path.
- Landing page: live "$X of standing demand across N collectors" from `/api/orderbook`, plus a QR code to `/buy`.
- **Recruit real buyers onsite:** goal 15+ attendees with standing orders and payment limits, including at least one judge if allowed.
- Get physical items: thrift or local game store run, or teammates' own cartridges. Record the real rack price.
- Own `DEMO.md`: script, shots, filming, editing, upload, Devpost, X post.

## Integration milestones

| When | Milestone |
|---|---|
| +20 min | Contracts committed, empty Worker deployed |
| +75 min | A: snap → SKU + grade. B: auction runs on seeded data. C: payment limit saved. |
| +105 min | **Full loop in test mode:** snap → auction → authorize → capture → Telegram pings |
| +120 min | Live mode $1 run. **Record backup take.** |
| 2:45 PM | Final take recorded |
| 3:15 PM | Devpost submitted (edit until 3:30) |

## Cut order if behind

1. Soft close / human raise-max
2. Shipping and delivery → Transfer (show capture only; say transfer-on-delivery is next)
3. Brainbase concierge (MCP and web still create orders)
4. SPT (use saved card)
5. Low-confidence SKU picker (demo with items that identify reliably)

**Never cut:** live auction with at least 3 agents, real payment authorized and captured, real onsite buyers, team on camera.

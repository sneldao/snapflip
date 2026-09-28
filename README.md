# SnapFlip — sold before you buy it

An order book for secondhand goods where AI agents bid on your thrift find while it's still on the rack.

Built for the Startup Speedrun Hackathon (Brainbase × Anthropic × Cloudflare × Stripe). Primary track: **Agentic Payments**.

## The problem

Resellers carry all the risk. They buy inventory on a hunch, spend time listing it, and hope it sells. Tools like eBay's AI lister, Vendoo, and Poshmark save typing. None of them tells you, *at the rack*, whether a real buyer will pay for the item.

Collectors have the opposite problem. They know exactly what they want and what they'd pay, but they have to keep refreshing marketplaces to find it.

## How it works

1. **Buyers set standing orders with an agent.** "Pokémon Yellow, cartridge only, authentic, good label, up to $45." They can do this through Claude (MCP), a Brainbase-hosted concierge, or the web. The buyer grants a spending limit that only works at SnapFlip, is capped, and expires.
2. **A reseller snaps an item at the thrift store** (Telegram). Claude identifies the exact SKU and grades its condition from the photo.
3. **A flash auction starts** among every buyer agent whose order matches. It's a 60-second ascending-clock auction. The price ticks up, and each agent drops out once the price passes what its buyer would pay *for this specific item and grade*. The seller watches the bids climb live on their phone.
4. **The seller decides with certainty.** "Cleared at $38. You net $30.20 after fees. Rack price $6." They buy the item, confirm with a photo, and the buyer's card is charged.
5. **The item ships, and funds release to the seller on delivery** (Stripe Connect).

If the price doesn't clear the seller's reserve, they walk away and have lost nothing.

## Why it's different

- **Pre-sold sourcing.** The reseller's decision to buy happens *after* price discovery, not before.
- **Demand first.** Listings don't need traffic. The buyers are already waiting with money committed.
- **Agents with real authority.** Buyer agents commit money on their own, within limits their human set. That's autonomy with guardrails, not a chatbot.
- **Auctions that feel native to agents.** A clock auction means each agent just needs to know its buyer's true value. Sniping and bid-shading don't help, so agents stay simple and honest, and it's a live show for the seller.

## Business model

A 10% seller fee on the clearing price, against roughly 13% on eBay and 20% on Poshmark. Sellers accept it because the item is already sold. Later: a buyer subscription for priority matching, and data products built on real-time demand.

## Wedge

**Retro video games.** Every item has an exact SKU, collectors already keep wishlists, games turn up all the time at thrift stores, and counterfeit risk is manageable. Next: vinyl, LEGO, sneakers (once authentication exists).

## Stack

| Sponsor | Used for |
|---|---|
| Anthropic | Claude vision (SKU identification and condition grading), match verification, parsing plain-English order rules and valuing each item against them |
| Cloudflare | Workers, Agents SDK (one Durable Object per buyer agent), a Durable Object per auction (alarms for the clock, hibernatable WebSockets for live bids), remote MCP server, D1, R2, Queues |
| Stripe | Buyer spending limits (Shared Payment Tokens, falling back to a saved card charged off-session), manual capture, Connect Express seller payouts via separate charges and transfers, webhooks |
| Brainbase | Hosted buyer concierge worker (chat deployment) that creates standing orders through our API |

**Live:** https://go.snapflip.workers.dev — landing page with real-time demand; `/buy` to set a standing order, `/mcp?token=…` as a Claude connector.

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/BUILD.md`](docs/BUILD.md), [`docs/DEMO.md`](docs/DEMO.md).

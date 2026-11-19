# PayPal AI Hackathon integration plan — SnapFlip

This document is the build frame of reference for adapting SnapFlip to the PayPal AI Hackathon.

## Goal
Show an AI-driven secondhand goods auction where a buyer pays via PayPal and the seller receives a PayPal payout, with AI handling identification, grading, matching, and valuation.

## Current relevant surfaces
- Architecture: `docs/ARCHITECTURE.md`
- Payments: Stripe PaymentIntent manual capture, Connect Express payouts
- AI: Claude vision, match verification, agent valuation
- Agents: buyer agents via MCP, Brainbase, web, Telegram Scout

## PayPal integration architecture

### Buyer payment
- Add PayPal Checkout authorization/capture alongside Stripe.
- Keep spending limits and caps enforced in code.
- Store PayPal transaction reference in auction/payment records.

### Seller payout
- Add PayPal Payouts for seller disbursement.
- Keep platform fee snapshot per sale.
- Store PayPal payout reference.

### AI layer
- Keep Claude SKU identification and grading.
- Keep Claude match verification and agent valuation.
- Optionally use APIMatic for PayPal-aware agent context.

## Week plan
- [ ] Add PayPal env vars/secrets.
- [ ] Implement PayPal buyer checkout path.
- [ ] Implement PayPal seller payout path.
- [ ] Add transaction/payout references to schema/records.
- [ ] Polish one end-to-end auction with PayPal payment + payout.
- [ ] Add README “do X, see Y” steps.
- [ ] Record demo video and submit.

## Demo script
1. Buyer sets standing order → sees spending limit.
2. Seller snaps item → sees AI SKU ID + grade.
3. Auction runs → sees bids and clearing price.
4. Buyer pays via PayPal → sees payment confirmation.
5. Seller dashboard/payout → sees PayPal payout + fee breakdown.

## Risks and fallbacks
- If replacing Stripe is too large, add PayPal as a parallel rail for the demo.
- If PayPal payout setup delays, record a successful sandbox payout and show it.

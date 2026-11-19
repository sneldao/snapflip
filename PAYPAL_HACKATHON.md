# PAYPAL_HACKATHON.md — Build What’s Next with PayPal and AI

> Project: **SnapFlip — sold before you buy it**
> Event: PayPal AI Hackathon (Devpost) — submissions Oct 1 – Nov 12, 2026; winners Dec 21, 2026
> Prize pool: $60,000+ USD
> Requirement: meaningfully use **both PayPal and AI**
> Repo: https://github.com/thisyearnofear/snapflip
> Live: https://go.snapflip.workers.dev

## 1. Event essentials
- Build window: **Oct 1 – Nov 12, 2026** (6-week build window).
- Winners announced: **Dec 21, 2026**.
- No prescribed tracks or problem statements.
- Submission requires a working project that meaningfully uses both PayPal and AI.
- Sponsor bonuses include: APIMatic, Render, Kernel, Channel3, Postman, Astropods, Elastic, AG Grid, Bryntum.

## 2. Why SnapFlip is a strong PayPal + AI candidate
SnapFlip already combines:
- **AI**: Claude vision for SKU identification and condition grading, match verification, plain-English order parsing, agent valuation.
- **Payments**: buyer spending limits, manual capture, seller payouts, platform fees.
- **Agent commerce**: buyer agents commit money within human-set limits.

PayPal can become a first-class payment/payout rail alongside (or in place of) Stripe for the hackathon demo, while AI remains central to identification, grading, matching, and auction behavior.

## 3. PayPal integration plan

### Payment rail
- Add PayPal Checkout for buyer payment authorization/capture.
- Add PayPal Payouts for seller disbursement.
- Keep spending-limit enforcement and fee snapshot logic unchanged.
- Store PayPal transaction/payout references in the existing auction/payment records.

### AI rail
- Keep Claude vision for SKU ID and grading.
- Keep Claude match verification and agent valuation.
- Optionally use PayPal/APIMatic context to give agents PayPal-aware payment context.

### Minimum viable win (2 weeks)
Scope to **one buyer, one seller, one successful auction**:
1. Buyer creates a standing order with a spending limit.
2. Seller snaps an item; AI identifies SKU and grades condition.
3. Flash auction runs and clears.
4. Buyer pays via PayPal.
5. Seller receives PayPal payout.
6. Platform fee is recorded.

## 4. Demo script (do X, see Y)
1. Buyer sets standing order → sees spending limit.
2. Seller snaps item → sees AI SKU ID + grade.
3. Auction runs → see bids and clearing price.
4. Buyer pays via PayPal → sees payment confirmation.
5. Seller dashboard/payout → sees PayPal payout + fee breakdown.

## 5. Sponsor bonus opportunities
- **Channel3**: use clean product data for SKU/catalog enrichment.
- **APIMatic**: give agents instant PayPal context.
- **AG Grid**: build a seller/buyer dashboard with charts.
- **Render**: deploy agents/services.

## 6. Risks and fallbacks
- **Risk:** replacing Stripe entirely is too large.  
  **Fallback:** add PayPal as a parallel rail for the demo path; keep Stripe for existing flows.
- **Risk:** PayPal sandbox/payout setup delays.  
  **Fallback:** record a successful PayPal sandbox transaction and show it in the demo.

## 7. Submission checklist
- [ ] Working prototype with PayPal + AI
- [ ] Public repo
- [ ] Demo video/screenshots
- [ ] README with setup + “do X, see Y”
- [ ] PayPal account details for any payout

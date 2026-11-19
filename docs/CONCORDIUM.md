# CONCORDIUM.md — Trusted Agents Hackathon

> Project: **SnapFlip — verified agents bid real money, or they don't bid**
> Event: Concordium Trusted Agents Hackathon (Encode Club) — submissions close Dec 9, 2026, 23:59 UTC
> Checkpoint 1: project + team + idea, **Sun Nov 22, 23:59 UTC**
> Prizes: 1M CCD each for 1st/2nd/3rd + eligibility for the 75M CCD grants programme
> Repo: https://github.com/sneldao/snapflip · Live: https://go.snapflip.workers.dev
> Requirements: run on Concordium testnet; meaningful use of ≥1 Concordium component;
> description, public repo, ≤3-min demo video, CCDExplorer link, path to production.

## Status (as built)

Done and tested:
- `src/lib/concordium.ts` — registry REST client (`badge-check`, `get-badge-JSON`, `verify-agent-card`), 60s cache, fail-closed; `admitBidders` join gate; `buildAgentCard`; `bindAgentBadge`/`badgeForBuyer`/`unbindAgentBadge`.
- Badge join gate in `AuctionDO.start()` — `REQUIRE_AGENT_BADGE=1`; refusals logged as `refused` bid events and shown on `/a/:id` (red chips + tape). Badged bidders show `✓` chips.
- `/.well-known/agent-card.json` — deterministic ERC-8004/A2A card; badge extension + `registrations` only once `SNAPFLIP_AGENT_BADGE`/`AGENT_TOKEN_ID`/`REGISTRY_CONTRACT` are set.
- `agent_identities` table (schema.sql + lazy DDL) links `buyer_id` → badge + owner account.
- `link_concordium_badge` MCP tool (collector path) + `POST/DELETE /api/agent-identity` (operator path, API key).
- `src/lib/x402.ts` + `src/agentapi.ts` — `/api/agent/market`, `/api/agent/collection` (dynamic per-item price), `POST /api/agent/auctions/:id/settle` (charges clearing_cents). Needs `X402_FACILITATOR_URL` + `X402_PAYEE`; off → 503. `x402_settlements` records the payer.
- **x402 capture rail** — `SETTLE_RAIL=x402` (+ gate configured) makes `persistAndSettle` park the auction in `awaiting_agent_payment` instead of a Stripe auth; the winning agent's settle call transitions it to `settled` (fee ledger + `x402_settlements` + presold notify). `capture()` is rail-aware (nothing to capture — the payment is atomic), `refund()` throws for x402 (PLT return transfer not built), and cron's `expireUnpaidAgentPayments` sweeps auctions whose winner never paid (2h, reopens the order). New `auctions.payment_rail`/`settle_tx_hash` columns (lazy ALTER like `platform_fees`). `GET /api/auctions/:id/receipts` now includes the settlement record next to the hash chain.
- **Receipt hash chain** — `src/lib/receipts.ts`: positional-canonical encoding, each event hash commits to the previous, refusals included; `head` is the week-3 on-chain anchor.
- `scripts/register-agents.mjs` (`npm run agents:register`): `card-hash`, `check-badge`, `verify-card`, `steps`.
- **Self-hosted facilitator** — `facilitator/server.mjs` (`npm run facilitator`): plain node HTTP server exposing the facilitator API (`GET /supported`, `POST /verify`, `POST /settle`, `GET /healthz`) over `x402Facilitator` + `ExactConcordiumScheme` + `toConcordiumFacilitatorSigner`. Sponsors gas for every settled payment; only `CCD_FACILITATOR_ADDRESS` + `CCD_FACILITATOR_PRIVATE_KEY` needed at runtime — point `X402_FACILITATOR_URL` at it. Replaces the unconfirmed hosted Boostabs facilitator.
- **Paying-agent demo** — `scripts/agent-pay.mjs` (`npm run agent:pay`): `settle <auctionId>` and `market <query>` — does the full 402 handshake (PAYMENT-REQUIRED → client `ExactConcordiumScheme.createPaymentPayload` → X-PAYMENT → PAYMENT-RESPONSE), prints the CCDExplorer tx link. Needs `CCD_PAYER_ADDRESS` + `CCD_PAYER_PRIVATE_KEY`.
- **`verify_agent_badge` MCP tool** — third-party agents can check a counterparty's badge over our own MCP server (the Workshop-2 beat: badge lookup with no browser). Returns `checkBadge`'s verdict + owner account.
- **Receipt anchor script** — `scripts/anchor-receipt.mjs` (`npm run receipt:anchor <auctionId>`): fetches the live `head` from `/api/auctions/:id/receipts`, calls hosted-MCP `build_set_metadata` to get a sign-ready payload that writes `receipt:<auctionId> → <head>` into the SnapFlip agent NFT's metadata — no custom contract. Wallet step is the only manual part (the script never holds keys).
- **PLT asset pricing** — `X402_ASSET` + `X402_ASSET_DECIMALS` env vars: when set, x402 prices are emitted in atomic asset units (`X402_ASSET=EURQ`, `X402_PRICE=0.05` → `50000` EURQ base units). Without them, `$`-prices resolve to the SDK's default-asset table (USDR on testnet).

Still needed: a funded testnet account + wallet, then register via the hosted MCP tools, hash-anchor the card, and flip `REQUIRE_AGENT_BADGE=1`. Then run the facilitator + a real `agent:pay` call end-to-end.

## Ecosystem research (Tavily deep-search, 2026-11-18)

Answers to the office-hours questions, from Concordium's own docs/articles:

- **"Agent must already run on a chain"?** Resolved — CIS-8004 is explicitly "an accountability layer bolted onto agents that already run elsewhere… without leaving its home" (`concordium.com/article/erc-8004-explained`). The *owner* is the Concordium account; the agent itself can live anywhere — a Cloudflare Worker qualifies. The "200+ chains" wording refers to where the badge can be *checked*, not where the agent must run.
- **Testnet contract index**: not needed by us. The hosted registry (`agent-registry-mcp.concordium.com`) runs mainnet+testnet+devnet configured; `build_register` returns a sign-ready `{hex, schema_json}` payload, and after registration `get_badge_json` (`GET /v1/get-badge-JSON/{badge}`) returns the exact `capabilities.extensions` + `registrations` block with correct contract coordinates — paste it into our card. Only set `REGISTRY_CONTRACT` from that output. Mainnet refs (for the card once we go live): CIS-8004 = `10082,0`, CIS-8 = `10081,0`.
- **Hosted MCP service**: `https://agent-registry-mcp.concordium.com` — `/mcp` JSON-RPC (40 tools: `build_agent_card`, `build_agent_badge`, `build_register`, `build_set_agent_uri`, `check_badge`, `verify_agent_card`, `get_badge_json`, `token_address`, `list_agents`, …), REST mirrors at `/v1/*`, `/docs` Swagger, `/openapi.json`, `/healthz`. Also self-runnable: `docker run concordium/agent-registry-mcp` with `MCP_NETWORK=testnet`.
- **x402 facilitator**: no public hosted URL found. One article says Concordium's facilitator "is provided via Boostabs" — get the URL from Discord/office hours. Fallback: **self-host** — `@x402/concordium/exact/facilitator` ships `ExactConcordiumScheme` + `toConcordiumFacilitatorSigner(address, key, {host, port, useTls})`; gRPC URL resolves via `getConcordiumGrpcUrl(network)` from `@x402/concordium`. Facilitator = sponsor account paying gas (the sponsored-tx story). Needs a small HTTP server exposing `/supported`, `/verify`, `/settle` (cord-dapp's `src/facilitator/server.ts` is the template).
- **PLT on testnet**: **EURQ** (Quantoz, MiCA-licensed euro) — the only PLT confirmed on testnet. USDR/EURR (StablR) are mainnet-only so far. NOTE: our `$`-style prices resolve to USDR — on testnet either register a money parser for EURQ or price with `{amount, asset:"EURQ"}` directly. Own-PLT issuance on testnet is possible via docs' "Request PLT issuance" flow.
- **Sponsored transactions**: documented tutorial path — sponsor service holds a sponsor key, sponsors V1 txs; users never hold CCD. For x402 the facilitator IS the sponsor (`extra.feePayer` in requirements).
- **x402 + identity**: Concordium's x402 can embed **ZK proof verification in the payment flow itself** — the facilitator "verifies the user's ZKP matches the requirements" (docs: Integrations → Implement X402 payments). That's the Verify-and-Access tie-in without a separate flow — candidate for the "private, verified users" direction.
- **CIS-8**: binds an external key (e.g. Ethereum `secp256k1` via `ethereum-personal-sign`) to a Concordium account; an agent can carry a `Cis8` external reference so EVM-side tooling resolves it. This is the "cross-chain badge" beat from Workshop 2 — optional, but a strong depth signal if we link an ETH address to the operator agent.

Revised blocker list: (1) funded testnet wallet — faucet + Wallet for Web; (2) facilitator URL — ask for Boostabs on Discord, else self-host; (3) EURQ availability for the settle price — or register a money parser. Everything else is code we already have.

## Checkpoint 1 submission (Nov 22)

Encode form fields:
- **Project name:** `SnapFlip`
- **Description:**
  > SnapFlip is a live agent-commerce marketplace: collectors give buyer agents standing orders, and the agents bid real money in 60-second auctions. On Concordium testnet, every bidding agent must carry a Verified by Concordium badge — unbadged agents are refused at the join gate — winners settle in a Protocol-Level Token via x402 with sponsored fees, and every bid and refusal lands in a hash-chained audit trail.
- **Project image:** `docs/media/hackathon-card.png` (generated by `scripts/gen-hackathon-card.py`)

Longer idea text for the project page:
> Agents that spend real money on behalf of people can't prove accountability today. SnapFlip's own shill-bidding defense was Telegram IDs and card fingerprints — fragile, and no use to a counterparty. We're rebuilding that trust on Concordium: every buyer agent carries a Verified by Concordium badge checked at the auction join gate (a badge-less agent is refused, visibly, on the live auction page). Settlement moves to x402 in a Protocol-Level Token with a facilitator sponsoring network fees — agents pay, users never touch crypto. External agents buy SnapFlip's market data the same way. Every join, drop, raise, win and refusal is a hash-chained receipt anchored on-chain — an audit trail that leads from an agent back to an accountable, identity-verified owner.

## 1. Event essentials
- Workshops ran Nov 2–18; build window opens Nov 19; office hours Tue/Fri 15:00 UTC from Nov 24.
- Judging: depth of Concordium integration, credible path to production, end-to-end demo works, usefulness. Test tokens are free — tx counts don't matter.
- Usable components: Concordium ID / Verify & Access, Agent Registry + Verified by Concordium badge, x402, Protocol-Level Tokens (PLT), sponsored transactions, Agent Registry MCP server.
- Reference implementation (same hackathon, different team): `grahamaine/cord-dapp` — badge checks on both sides, own x402 facilitator, hash-chained receipts. Read `src/lib/badge.ts`, `src/facilitator/server.ts` for shapes.

## 2. Why SnapFlip is a strong candidate
SnapFlip already has what the brief asks entrants to build toward: agents that commit money
autonomously on a human's behalf, a live MCP server, and a money rail. What it cannot show today
is *who stands behind each bidding agent* — the exact gap the badge fills.

| Judging criterion | SnapFlip's answer |
|---|---|
| Depth of integration | 5 components in one loop: Agent Registry + badge (join gate), x402 (settlement + paid endpoints), PLT (pricing), sponsored txs (nobody sees fees). 6th: collector verifies with Concordium ID. |
| Path to production | Live marketplace with real Stripe rail. Badge = the sybil/fraud layer fiat can't give; sponsored txs = non-crypto users never touch CCD; LEI business identity for pro sellers is the enterprise path. |
| It works | Live auction page already shows agent chips per bidder — badge stamps make the trust verdict *visible*. The unbadged-agent refusal is a negative-path proof, not a happy-path slide. |
| Usefulness | Shill bidding is SnapFlip's real fraud class. Today detected by Telegram ID + card fingerprint; badge gives privacy-preserving personhood — "one verified human behind each bidding agent" without learning who. |

## 3. The trust gate (the differentiator)
1. `BuyerAgent` joins an auction → join gate checks its badge resolves to an **Active** agent in the
   registry (`agent_of` → owner, status, `agent_uri`, `metadata_hash`; then SHA-256 the card).
   Unbadged / revoked / hash-mismatched agents are refused *before* the clock starts.
2. Winning agent pays the clearing price over x402 in a PLT — the facilitator sponsors the CCD fee,
   so neither side holds CCD. Buyer's pre-payment hook checks the payee is badged and the amount is
   under `max_cents`/`limit_cents` — the existing mandate becomes the payment policy.
3. Every join/drop/win/settle lands in the `bids` log + a hash-chained receipt anchored on-chain —
   an Article-12-style record that ties each decision to an accountable owner.

## 4. Two badge models (both)
- **SnapFlip as verified operator:** the BuyerAgent fleet + Scout register under SnapFlip's verified
  business account. "A verified business stands behind every bidding agent." One-time setup via
  https://agent-registry.concordium.com (testnet).
- **One collector verifies:** a demo collector creates a Concordium ID/account, registers their
  personal agent's badge against it. Proves "a verified *person* — not just SnapFlip — stands behind
  this agent." Heavier UX; film it for the video. Fallback if ID onboarding stalls: operator model
  only + a Verify-and-Access uniqueness check on `/buy` signup.

## 5. Integration plan

### Identity & badges (week 1)
- `GET /.well-known/agent-card.json` — Agent Card for the SnapFlip buyer-agent class (A2A format,
  `capabilities.extensions` carrying the `concordium-badge/v1` block once minted). Separate card for Scout.
- `scripts/register-agents.ts` — register agents on testnet CIS-8004 (registry dApp for the
  operator-owned fleet; script for repeatability). Store badges in D1 (`agents.badge`,
  `agents.registry_token_id`) and secrets in wrangler vars.
- `src/lib/concordium.ts` — `resolveBadge(badge) → {owner, status, agentUri, metadataHash}`,
  `verifyCard(uri, expectedHash)`, `badgeOk(badge) → boolean` with a short cache. Uses the hosted
  registry indexer REST API where possible, gRPC/`@concordium/web-sdk` for `agent_of` fallback.
- Join gate: `src/auction.ts` bidder filter gains `&& badgeOk`. Order creation
  (`src/orders.ts` `createOrder`, `src/mcp.ts` `create_standing_order`) attaches the buyer's badge.
- Demo surface: agent chips on `/a/{id}` get a "Verified by Concordium" stamp; a badge-less chip is
  visibly refused at join.

### Payments (week 2)
- x402 settlement rail in `src/payments.ts` parallel to Stripe (the `TODO(C)` rail slot in
  `settleAuction`): winner pays `clearing_cents` in a testnet PLT to the seller's Concordium
  account via `@x402/concordium`; facilitator sponsors the fee. If auth fails, next eligible
  bidder wins — same fallback semantics as the Stripe path.
- x402-gate `GET /api/market` and `GET /api/collection` for non-browser callers (agents pay per
  appraisal); browsers/session buyers keep free access.
- Own facilitator (cord-dapp pattern) unless a hosted testnet one exists — the facilitator *is*
  part of the story: SnapFlip sponsors its users' fees.

### Audit (week 3)
- Extend `bids` with a receipt chain: each event appends `hash(prev ‖ event)`; auction settlement
  anchors the head hash on-chain (memo tx). `GET /a/{id}/receipt` renders the chain + verify fn.
- CCDExplorer links: agent NFTs, settlement txs, anchor txs — into README + submission.

## 6. Schema additions (D1)
```sql
agents      (id, kind, name, badge, registry_token_id, card_uri, card_sha256, ccd_account, status)
buyers      + ccd_account, badge                      -- nullable; Stripe buyers unaffected
orders      + payment_rail TEXT DEFAULT 'stripe'      -- 'stripe' | 'x402'
auctions    + settle_tx_hash, receipt_head_hash
receipts    (auction_id, seq, event, payload_json, prev_hash, hash, at)
```

## 7. Minimum viable win
One demo, one command: 3 buyer agents join a Pokémon Yellow auction — two badged, one not.
Refused at join → badged agents bid → winner settles in PLT via x402 (sponsored) →
receipt chain verifies → CCDExplorer shows the registration, the payment, the anchor.

## 8. Open questions for office hours (Tue/Fri 15:00 UTC)
- Testnet CIS-8004 / CIS-8 contract indexes (registry dApp / `contract_info` MCP tool on testnet).
- Is there a hosted testnet x402 facilitator, or is "run your own" the expected path?
- Testnet PLT: is USDR available, or request issuance of our own?
- Confirm organizers are fine with an agent that isn't already on a chain (SnapFlip's agents live on
  Cloudflare + Stripe today — arguably the cleanest "users never touch crypto" story).
- Badge model: does the registry see the operator-of-fleet model as sufficient "verified human
  behind the agent," or is per-collector verification expected?

## 9. Risks and fallbacks
- **Registry/testnet friction** → register operator fleet via dApp UI (few clicks), script later.
- **Collector ID onboarding too heavy for the demo** → ship operator model only; keep V&A as the
  "one human, one order" signup gate instead of per-agent badge.
- **x402 facilitator complexity** → cord-dapp's facilitator shape is the reference; worst case,
  settle via direct PLT transfer + record tx hash (still shows agent-pays-agent, loses the 402
  dance — don't ship this unless forced).
- **Scope creep** → do not touch studio, Scout prompts, or the Stripe rail beyond the parallel
  rail seam.

## 10. Submission checklist
- [ ] Public repo with README section mapping Concordium components → files
- [ ] ≤3-min demo video: badge refusal → auction → x402 settle → receipt verify
- [ ] CCDExplorer links: agent NFTs, settlement tx, audit anchor
- [ ] Path to production: mainnet CAIP-2 + `<10082,0>` registry, USDR pricing, facilitator as a
      paid service, LEI business identity for sellers, Stripe stays for fiat

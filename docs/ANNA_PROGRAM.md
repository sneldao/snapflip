# Anna AI App Builder Program — SnapFlip

This document is the evaluation frame for listing a SnapFlip slice on the Anna
Marketplace. Program: <https://dorahacks.io/hackathon/2349/detail> ·
Q&A: <https://forum.anna.partners>. Facts read 2026-11-16.

## What it is

Not a hackathon prize — a **recurring monthly grant** for apps published on
the Anna Marketplace. Up to $5,000 per app per eligible month ($80k/month
pool). Grants start at **200 Qualified MAU** in a single calendar month.
Founding Builder cutoff: **30 Nov 2026, 15:59 UTC**.

- Qualified MAU = unique **signed-in** Anna users each completing ≥1 Qualified
  App Run (primary function → meaningful result, verified server-side).
- Accepted inputs: existing Python/Node scripts, AI agents, **MCP servers**,
  workflows, SaaS products.
- Review: 3–5 business days; DoraHacks BUIDL can be filed while pending.

## The gate

200 signed-in users × 1 run inside the November window — submit for review by
~20 Nov to leave ~9 measurement days. Anonymous `workers.dev` traffic does not
count; users must sign into Anna. Distribution is the risk, not the build.

## Scope decision

The Anna app is the **appraisal + price-watch utility**, not the order book:

- **In scope:** "appraise my childhood box" (`/box`), market pricing
  (`/api/market`), price-watch signup — one run, one shareable number.
- **Out of scope:** live auction book, agent bidding, payments, the 3D studio
  — none of which fit a qualified-run definition or a 9-day MAU push.

## Current relevant surfaces

- `src/mcp.ts` — Claude-connector MCP surface already live at `/mcp?token=…`;
  MCP servers are a listed input.
- `src/market.ts` — `/api/market` real market pricing.
- `src/live-tg.ts`, `src/pricewatch.ts` — Telegram collector desk + price watch.
- Architecture: `docs/ARCHITECTURE.md`.
- Existing audience: Telegram/SMS line, workers.dev landing traffic — the only
  funnel we could route through Anna sign-in.

## Plan (if entered)

- [ ] Request Anna developer access; check SDK UI + qualified-run reporting
- [ ] Wrap appraisal flow as an Anna app (worker calls stay on our origin or
      port into Anna's sandbox — decide from the SDK)
- [ ] Submit for review (~by 20 Nov) + file DoraHacks BUIDL
- [ ] Push the Telegram/SMS list through Anna sign-in; track qualified runs

## Status, 2026-11-16

Under evaluation. Nothing submitted; no Anna developer account requested.

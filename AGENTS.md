# SnapFlip — agent notes

## Deploy account

Production deploys must run against the Cloudflare account
**thepapajams@gmail.com** — it owns the `snapflip` workers.dev subdomain
(`go.snapflip.workers.dev`) and the D1 database bound in
`wrangler.jsonc` (`08a6acfb-3cce-4a9b-96d1-2ac5c962bb96`).

Do NOT `wrangler deploy` while logged in as any other account — bindings
will be auto-provisioned into a parallel, broken stack under a different
URL (this happened once: a stray `snapflip-photos` R2 bucket and
`snapflip-match` queue were created on the wrong account and had to be
deleted). Check `npx wrangler whoami` before deploying.

## Studio

- Entry: `src/studio/client.ts` (bundled to `public/app/` via esbuild
  `--splitting`; `public/app/` is gitignored, rebuilt by `predev`/
  `predeploy`/`precheck`).
- Commands: `npm run dev` (wrangler, builds studio first),
  `npm run check:studio` (strict DOM-lib typecheck of the client graph),
  `npm test`, `npm run lint`, `npm run deploy`.
- `src/studio/client.ts`, `src/studio/audio.ts`, `src/studio/world/` are
  DOM-only and excluded from the worker `tsconfig`; they're checked by
  `check:studio` instead.
- Deep-link params: `?ch=`, `?splat=`, `?credit=`, `?env=`, `?demo=1`
  (`&loop=0` to hold), `?fx=0` (no post), `?gl2=1` (WebGL2 backend),
  `?gpu=0` (legacy WebGLRenderer), `?debug` (diagnostics incl. backend),
  `?fast=1` (skip listing cold-open), `?cond=` + `?rule=1` + `?claim=`
  (director's mode — plant hidden condition vs the seller's claim).
- Plan: `docs/studio/STRATEGY.md`. Running status of what's built and
  verified: `docs/studio/STATUS.md` — update STATUS as work lands, not
  STRATEGY.

## Docs

- `docs/ARCHITECTURE.md` — system design (components, endpoints, schema).
- `docs/studio/` — STRATEGY (plan), STATUS (running log), USER_TEST_PLAN.
- `docs/history/` — hackathon-day artifacts (BUILD, DEMO, SUBMISSION);
  statuses there are frozen, not current.
- `docs/internal/` — ops runbook, machine-local only; gitignored and
  never committed.

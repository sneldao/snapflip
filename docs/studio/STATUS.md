# SnapFlip Studio — status log

Running implementation status for the Studio build. The plan itself lives
in [STRATEGY.md](STRATEGY.md); this file is what is *actually built and
verified*, newest entries last. Update this file as work lands; do not
record status in STRATEGY.md.

## Current state (verified, honest baseline)

- Live site today: hero "Tell an agent what you're hunting" and "LIVE · REAL
  MONEY · REAL AGENTS"; $0 standing demand/collectors/sales currently. The
  landing's $0 stats and simulated hero tape must not lead the judge flow;
  remove or qualify the unverified live-money badge on the new entry path,
  and label all simulated data explicitly.
- `/buy` starts a standing order then asks for a card. Page uses a cream/CRT
  arcade thrift-market aesthetic.
- Stack: Hono Worker, D1/R2/Queue, auction Durable Object clock over
  WebSocket, buyer order rules (`match.ts`), photo findings/annotations
  (`src/web/auction.ts` 2D boxes), Stripe test/stub flow, MCP, Telegram form
  prototype. Sep 30 docs are not fresh proof of transaction — do not claim
  live transactions, real money, or live payout anywhere.
- An uncommitted local `/studio` world now exists: one Three.js scene with
  three authored spaces (Rack shop interior, Inspection Atelier, Auction
  Chamber), a persistent cartridge proxy that travels between them on
  directed portal-following camera transitions, surface-anchored evidence
  markers, a draggable raking lamp, rotatable item, in-world provenance
  plates that mount user-uploaded source photos (dev-only
  `POST /api/studio/photos` → R2 `studio-*` keys → `GET /studio-photos/:key`,
  magic-byte sniffed, 8MB cap, labeled "SOURCE PHOTO — UNVERIFIED"), a
  deterministic five-pod bid sequence with gavel-outcome and an
  evidence-to-agent light arc, `?ch=`/`?ev=`/`?debug` deep links, renderer
  diagnostics (159 calls / 6k tris at audit), dev-only model preview, and
  mobile portrait fixes. Real-browser QA passed: item rotate (−0.35→0.73 rad),
  marker occlusion, marker→evidence card, lamp drag (free θ → chip/spec/undo
  sync), transition + evidence arc. Verified via real browser + headless
  frames + 35 tests. Spec edits now reveal in-frame: a lightSide change
  swings the lamp through a 550ms smoothstep arc (verified live: θ 0.35 →
  2.79 through a mid-swing sample), and any spec/condition apply pulses the
  item scale briefly. Craft pass added: articulated lamp + volumetric beam
  cone, 140 drifting dust motes, etched measuring dial, paper-fiber/aged
  label + LOT 07 sticker, shell wear-roughness map + scuff decals, LOT tag
  cards on bins, chamber LOT placard + bidder paddles, gavel strike ring +
  camera impulse, flowing arc beads, camera breathing + mid-flight FOV push.
  Diagnostics after pass: 162 calls / 22k tris / 205 geos / 26 tex — inside
  budget. Still blockout+: no real item reconstruction, hero proxy unchanged
  by photos, not showcase-final.

- Research-driven pass (Tavily survey of award-tier three.js work — Oryzo
  inertia, Cartier scene-per-product + audio score, Shopify scroll-as-
  narrative, Hubtown pointer-reveal): item drag now coasts with inertia
  (verified live: −0.35 → 0.92 drag → 1.99 rad released), pointer parallax on
  composed shots, wheel/trackpad + arrow-key chapter navigation (wheel stays
  OrbitControls-zoom inside the Atelier), first-visit gesture hints that
  strike through once performed, and a fully synthesized Web Audio layer
  (per-chapter room tone, pod-pop ticks, gavel knock, paper slide, transition
  whoosh; mute toggle persisted; no assets, gesture-gated).
- Renderer moved to `WebGPURenderer` (three r186 `three/webgpu`, lazy chunk
  ~700KB): real WebGPU backend where available, WebGL2 backend otherwise —
  verified `gpu webgpu` live + webgl2 headless frames; `?gpu=0` forces the
  legacy `WebGLRenderer` pipeline as escape hatch. Backend shown in `?debug`.
  esbuild now uses `--splitting` → `public/app/` (ignored by lint/git).
- Splat scaffold PROVEN end-to-end: `?splat=<url>` loads .splat/.ksplat/.ply
  /`.spz` (r186 `SPZLoader` exists — earlier note was wrong) into a
  `GaussianSplat` visual skin fitted to the proxy bounds (source
  `splatGeometry`, not the billboard quad, supplies bounds); the proxy stays
  invisible for anchors/raycast occlusion/drag; provenance badge flips to
  "photo reconstruction · <credit>" (`?credit=`). Verified with a synthetic
  `public/test.splat` (3600 splats) and the three.js-repo CC-BY millipede
  (`public/millipede.splat`, 3.7MB, attribution file alongside). Path to real
  hero grounding: user's consented photos → capture → SuperSplat downsample
  (200–500K splats, ≤15–30MB web target) → `?splat=`.
- Big-swing pass (all six differentiators implemented):
  - Post FX: WebGPU/node `PostProcessing` pipeline — pass → bloom(0.30,
    0.22, 0.82) → vignette smoothstep → film grain 0.09; `?fx=0` disables;
    only on node backends (`postFx` in `?debug`). Verified `postFx: true`
    on real WebGPU Chrome with visible bloom/grain/vignette.
  - `?demo=1` autopilot: scripted Rack→Atelier (auto item-spin + evidence
    select)→Chamber→hold, loops unless `&loop=0`. Code-verified; user to
    eyeball timings.
  - Photo↔splat view matching: provenance plates are raycast targets; a
    no-drag click tweens splat yaw to that plate's view (front 0 / rear π,
    650ms smoothstep). Verified via direct call 0→π→0.
  - Evidence pinning on the real surface: clicking the capture raycasts the
    invisible proxy, snaps `anchors[0]` to the nearest `splatGeometry`
    center (stride-capped search), and auto-selects the evidence card.
    Verified: anchor moved to a real surface point.
  - Rationale replay: collector pod gets a dropout-basis plate
    ("OUT — BASIS" + wrapped reason) that fades in only when signal off
    and intro ended; `setRationale` wired from `evaluateDecision().reason`.
  - Hybrid splat environment: `?env=<url>` loads a photographed room,
    `fitSplatToBox` fits it to the discover chapter bounds, authored rack
    meshes hide, `envSplatActive` getter. Verified with synthetic
    `public/test-env.splat` (43K splats, speckled room visible behind
    pedestal) — needs a real room capture to look like more than noise.
- Robustness: `r.init()` wrapped in a 5s race → falls back to legacy
  WebGLRenderer on adapter stall (hit during QA when many tabs held GPU
  devices); `?gl2=1` forces the WebGPURenderer's WebGL2 backend — splats
  and postFX without native WebGPU.
- Honest caveats: WebGPU path renders equivalently to legacy in A/B captures
  (PCFSoftShadowMap is removed upstream — PCFShadowMap applied on node
  backends); audio unverifiable headlessly (code-verified only); splat-on-
  spec-rebuild and real-capture quality still unproven; no real photo set
  yet; env splat proven with a synthetic room, not a real capture.


## UX pass (Oct 12) — what changed and what is still open

Implemented from a code-level review (not browser-verified):

- One focal card per chapter (`focusCard` in `src/studio/ux.ts`); appraisal
  folded into the decision card; mobile uses one card slot.
- One instruction at a time in the gesture hint (`hintFor`), as text in a
  live region.
- Hover feedback in the Atelier: grab cursor on the lamp head and item, and a
  halo on the lamp head (`setHover` in `chapters.ts`).
- Keyboard in the Atelier: ← → move the lamp, ↑ ↓ turn the item, [ ] change
  chapter. Elsewhere ← → still change chapter.
- Wheel changes chapter only with Shift held; plain scroll is untouched.
- `touch-action: none` on the canvas so touch drags reach the lamp and item.
  Not yet confirmed on a device.
- Demo autopilot timers are tracked and cancelled on any real pointer or key
  input.
- Minimum HUD text size is 12px.
- `client.ts` is one state object with a single `render()`; undo stores
  snapshots.
- Marker projection and occlusion moved to `world/markers.ts` (occlusion
  refreshed every third frame or when dirty). WebGPU post chain moved to
  `world/postfx.ts`.
- Fixed: after pinning evidence, the marker stayed on the old anchor.

Still open:

- Pointer and drag handling is still inside `WorldController.ts`. Split it out
  only after a live drag check.
- Hero asset (Phase 7) is blocked on consented multi-angle photo sets and an
  asset-rights and cost decision.
- Hover, keyboard, touch, and demo timing have not been checked in a browser.


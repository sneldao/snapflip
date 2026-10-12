# AI Builder Hackathon 2026 — SnapFlip Studio Strategy

Internal strategy doc. Goal: **aim to win** the Victoria VR AI Builder
Hackathon 2026. Existing SnapFlip is treated as prototype/foundation; this
entry requires substantial new product, UX, and visual execution — not a
minimal `/lab` add-on. Dates below are internal targets, not promises. No
submission-field copy is authored here. No claim of a guaranteed win.

Organizer sources (authoritative — recheck for changed notices before submitting):
- [AI Builder Hackathon 2026 — The Building Period](https://www.victoriavr.com/news/ai-builder-hackathon-2026-the-building-period-2042daf3)
- [Hackathon 2026 Terms](https://www.victoriavr.com/hackathon/2026/terms)
- [Official builder](https://www.victoriavr.com/builder) — markets
  prompt-to-assets/worlds, visual editing, and logic blocks. Our
  differentiation is focused commerce / evidence / agent behavior, NOT a
  generic builder clone.

## What the organizer requires (verified)

- §6.1: plain language -> 3D scenes AND working logic, running in the
  browser; a separate backend is allowed.
- §6.2: public repo, hosted demo, video under 3 minutes, short description,
  one selected focus category.
- §6.3: demo must stay functional throughout evaluation.
- §6.4: no material changes after the deadline unless allowed.
- §7: preexisting tools/assets allowed, subject to licenses and credit.
- §9.4: judges may try their own prompts, including outside our chosen
  focus — off-domain handling must hold up.
- Build window Sep 11 – Nov 11, 2026; submission cutoff **Nov 11, 2026
  16:30 CEST** (organizer states UTC+2). Registration closed Sep 8, 2026;
  registered (user confirmed Oct 11); team/focus category still verify
  (Gate 0).

## Positioning

**SnapFlip Studio** (working name): an AI-native 3D commerce experience. The
user creates an interactive inspection-and-auction world from a seller's
photos and plain-language collector intent. Inspectable 3D condition
evidence changes simulated or real buyer-agent decisions and auction
tension.

Signature 10-second reveal: a photo becomes a spatial inspectable object;
the user refines it in natural language; lighting and decision change
together; an agent exits citing evidence; the scene transforms into
sale/no-sale. AI builds scene + behavior — NOT a static object, NOT NPC
decoration.

We surface the existing auction backend as live credibility, but card,
Telegram, and accounts are never dependencies for judges.

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

## Why this beats the previous plan

The earlier plan was a defensive `/lab` bolt-on. The first Studio slice proves
rendering and a safe scene-spec seam, but its small object, empty floor,
pedestal, and permanent three-column UI cannot carry a showcase. The new
product is **one continuous world that makes a find consequential**: its
object, evidence, buyer intent, and auction state persist as the camera moves
from discovery through inspection to price discovery. We replace the local
Studio shell; we do not polish its rails. The existing auction DO, buyer-order
rules, and photo grading become the credibility layer under a substantially
new spatial product.

## One world, three spatial chapters

The browser opens into the world, not a marketing page or dashboard. The same
canonical item moves through these connected spaces, with camera travel and
persistent scene state rather than three disconnected pages:

1. **The Rack — discovery.** Layered thrift shelves, bins, hand-written price
   tags, practical lights and foreground clutter give the find a place and
   scale. A seller uploads consented photos in-browser, or a judge selects an
   explicitly labeled sample. The camera frames the find before any controls.
2. **The Inspection Atelier — evidence.** The object moves to a lit examination
   rig. Orbit, close focus, lighting direction and source-photo comparison
   expose only photographed condition. Evidence anchors are spatial and
   occlusion-aware; unsupported backs/edges remain unverified. The judge can
   describe a new scene or rule and also manipulate the world directly.
3. **The Auction Chamber — consequence.** The item enters a curved room of
   distinct agent stations. Price and clock remain readable in space; each
   dropout extinguishes a station and connects its reason to an inspection
   anchor. A final sale/no-sale receipt closes the spatial journey.

Camera model: directed, skippable transitions between chapters; constrained
orbit/zoom only during inspection, with reset/focus controls. No forced WASD
navigation. A compact contextual prompt opens when needed, evidence detail
appears beside the selected surface, and history/replay is a secondary drawer.
The existing permanent provenance/director/timeline rails are replaced, not
reskinned. Mobile uses its own camera composition and touch targets. Judges
need no account, card, Telegram or active buyer; replay is labeled simulated,
while any live DO feed is read-only.

## Visual direction and storyboard gate

**Found-object theatre escalating to a live auction:** Rack = tungsten and
ink-dark timber; Atelier = porcelain, brushed metal and controlled raking
light; Chamber = deeper charcoal, warm signal lights and a legible clock.
The object silhouette, material finish, believable scale and a layered world
carry the spectacle. Do not use darkness, bloom, fog, flat primitives or
stock footage to hide an empty scene. No fake metrics, testimonials, device
frames, or authenticity claims.

Before broad implementation, approve actual rendered pixels for six frames:
Rack opening; object selection; Atelier front inspection; condition close-up
with source-photo link; agent dropout in Chamber; final outcome. Each frame
locks subject scale, camera, palette, light, overlays and the next eye target.
Motion then connects approved frames: photo-to-object reveal, motivated
camera transfer, light relight, evidence-to-agent causal line, station exit,
receipt. Every cue follows state, with a reduced-motion/static equivalent.
Showcase footage is captured from the same interactive world, not a separate
video-only composition.

## Three.js production architecture

Keep Hono/Worker/D1/R2/DO and the existing commerce code, but replace the
monolithic Studio renderer with one `WorldController` owning scene, camera,
renderer, frame loop, resize and disposal. Separate chapter composition,
asset registry, reusable prop/material kits, camera direction, evidence
picking, deterministic event projection, and diagnostics. The versioned
scene document is canonical; Three.js objects and UI derive from it, not the
reverse. World coordinates, item scale/pivot and camera targets are defined
once so imported assets, pins and camera transitions agree.

- **Asset source ledger:** hero cartridge = authored/imported GLB built from
  measured form and consented multi-angle photos, with source-visible UVs,
  separate shell/label/contact materials and wear decals. No copyrighted
  label art without rights. Rack/Atelier/Chamber architecture and repeated
  props = a coherent modular kit (authored pieces plus instanced support
  details); high-value signature props may use licensed/generated assets
  only after rights and cost approval. The current procedural cartridge is
  a fallback/blockout, not the final hero.
- **Reconstruction feasibility:** test three consented real item photo sets
  against a repeatable capture-to-GLB process. Promote asynchronous output
  only if inspectable from front/side/back with accurate condition cues and
  browser-safe size; otherwise keep the authored hero and explicitly mark
  uploaded items as photo-textured proxies. Never present invented surfaces
  as observation or delay a live 60-second auction for asset processing.
- **Rendering:** intentional sRGB/tone mapping and neutral image-based fill,
  one motivated key plus restrained rim/contact lighting, tuned materials
  before effects. Use scene depth and architectural silhouette rather than
  heavy fog/bloom. Camera transitions are deterministic, skippable and
  reduced-motion aware. Repeated details are instanced, distant kit uses
  LOD/culling, and every imported asset is normalized at one boundary.
- **Render starting budgets, measured at active scenes:** desktop <=300 draw
  calls and <=750k triangles; mobile <=150 calls and <=300k triangles; DPR
  <=2 desktop and <=1.5 mobile; at most two shadow-casting lights desktop,
  one mobile. Record actual calls, triangles, geometries, textures, frame
  behavior, shadow/post settings and desktop/mobile screenshots after each
  art pass. These are targets to test and revise, not claims about current
  performance.

### Asset-source ledger (starting state)

| Surface | Planned source | Current state / gate |
|---|---|---|
| Hero cartridge and condition textures | Measured authored GLB + user-owned multi-angle photos; licensed/generated model only if rights and cost approved | No source photo set or GLB in repo; request three consented sets before texture/provenance work |
| Rack architecture and shop props | Authored modular Three.js/GLB kit; repeated detail instanced | No 3D assets yet; first pass is explicitly a blockout |
| Atelier apparatus and evidence UI | Authored geometry/material kit, source-photo crops from consented captures | No observed 3D evidence yet; sample pins remain scenario-only |
| Chamber architecture and agent stations | Authored spatial kit plus deterministic state-driven light/camera cues | Existing DO and simulation rules available; no spatial chamber yet |
| Image textures, signage, sound | Original or appropriately licensed files with source/terms recorded before integration | Existing footage is not the new world's asset base; sourcing/rights pending |

No paid generation or remote Mint asset write without explicit approval. When
real assets are integrated, keep an asset manifest with authorship, license,
source view, scale, bounds, polygon/material/texture counts and usage location.

## AI scene and logic contract

The model proposes a validated scene document: supported object family,
chapter layout/style, materials, lighting, inspection anchors, camera cues
and an allowlisted condition/agent rule graph. It never emits executable JS.
A deterministic engine owns rule evaluation and a seekable replay; prompt
edits and direct manipulation produce the same versioned document with
undo/redo and a visible before/after. Existing 2D photo boxes map only to
photographed planes. A 3D pin needs a source view, correspondence and
confidence; otherwise it is clearly a scenario marker. Buyer limits remain
code-enforced in `src/match.ts`; Studio simulation and real commerce state
are isolated. A live auction, if connected, feeds the Chamber read-only.
Public judge generation needs its own quotas, bounded inputs, retention and
server-held provider keys before the dev-only preview endpoint is promoted.

## Acceptance test cases (lead-authored — verbatim)

Initial:
> Build an inspection room for a worn Pokémon Yellow cartridge. Put the label
> under a raking light; let me inspect the edge and show when a collector
> capped at $45 walks away.

Revision:
> Move the light to the left and reject this copy if the label is torn.

Off-domain:
> Build a display for a ceramic vase with a light that reveals a chip;
> reject it if chipped.

Gates:
- Initial case produces a navigable spatial scene AND observable functional
  decisions.
- Revision visibly moves the light AND changes deterministic rejection
  behavior with a traceable explanation.
- Reload/share preserves the current version and a prior version can be
  restored.
- Off-domain input returns a useful, clearly scoped generic object/scene
  with working inspect-and-reject logic, or an honest unsupported response —
  not a hallucinated SKU.
- No background photo masquerades as a reconstructed model.
- On model outage: honest error or clearly labeled sample — never canned
  output presented as generation. No payment required anywhere.

## Internal gates (remaining month, as of Oct 11)

Owner roles (may overlap): product/creative director (vision, storyboard,
demo); 3D technical art (hero/kit/render/motion); AI/interaction (scene
document, edits, rules/evidence); backend/integration (assets, persistence,
DO bridge, quotas); QA/story (judge path, capture, accessibility). Cadence:
a daily two-minute world walkthrough and twice-weekly external eyes.

- **Gate 0 — now** (product/creative): registration confirmed by user Oct 11;
  verify team/focus category, collect three consented photo sets, audit asset
  rights, approve six rendered storyboard frames. If team/category cannot
  be confirmed, escalate with organizer; block submission, not prototype work.
- **Gate 1 — internal target Oct 18** (3D art + interaction): replace the
  three-column shell with one full-bleed world. Build Rack, Atelier and
  Chamber blockouts in one scene, with distinct silhouettes, motivated
  lighting, a persistent object and skippable directed camera transitions.
  Gate: all six frames are captured from the running world; a fresh visitor
  understands the journey without the old sidebars. Placeholder hero is
  explicitly a blockout, not final evidence. Current status: three-chapter
  frames captured headlessly and iterated (four rounds) — composition reads;
  camera-aim, item-seating, z-fighting, and buried-label defects were found
  and fixed. Real-browser interactive QA (drag lamp, rotate item, transit
  motion, marker→arc) and final frame approval still pending — do not mark
  this gate fully passed until those are exercised live.
- **Gate 2 — internal target Oct 25** (3D art + backend): authored hero GLB,
  modular prop/material kit, real-source texture/provenance, browser photo
  intake and grounded inspection. Test reconstruction on three real sets;
  accept only accurate browser-safe output, never invented condition. Gate:
  front/side/close-up stay readable at desktop and mobile; photo comparison
  reveals which surfaces were actually captured.
- **Gate 3 — internal target Nov 1** (AI/interaction + backend): natural
  language edits change the versioned world document AND rule outcome;
  direct controls share undo/redo; deterministic auction replay drives
  station exits, clock, price and evidence link. Add read-only live DO feed
  only if ready. Gate: the acceptance cases above pass from a clean browser,
  with no card/login and honest simulation labels.
- **Gate 4 — internal target Nov 6** (creative + QA/story): refine object
  materials, camera choreography, motivated VFX/sound, mobile composition,
  keyboard/touch/reduced-motion and WebGL fallback; capture backup take.
  Gate: fresh-browser run, recorded desktop/mobile active frames, renderer
  diagnostics and scene readability review show no primitive-dominant hero,
  empty world, clipped UI, obscured evidence or untraceable agent reason.
- **Freeze Nov 9; submit buffer Nov 10; organizer deadline Nov 11 16:30
  CEST.** These are internal targets, not promises.

## Scope cuts (in order, if behind)

Cut: Vault -> decorative NPCs -> extra item families -> unproven bespoke
reconstruction -> advanced seller payments. NEVER cut: an authored hero and
layered connected world, prompt -> 3D scene + working logic, grounded
inspection, a functional consequence, truthful provenance and a usable
no-login judge path. A polished offline replay of real-data events, labeled
as replay, beats a flaky live feed. Payments are supporting evidence, not
the central show.

## Showmanship / video (<3 min) outline

1. First 10s: hero reveal — condition, agent reaction. No architecture
   preamble.
2. Actual photo intake and prompt input.
3. Model generation and tangible 3D result.
4. Revision prompt — BOTH physical light and decision change on screen.
5. Zoom into evidence/provenance.
6. Agents leaving / clock / clear or no-sale.
7. Quick behind-the-scenes schema/event proof.
8. Close on a fresh-browser invitation to try their own prompt.

Readable captions, restrained sound, product screen capture plus one
physical-object shot. No fake live money; no prerecorded AI answer passed
off as a live judge demo. Website demo offers a self-serve 1-click sample
plus a new-prompt field. No paste-ready submission text is authored here.

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

## Risks and caveats

- Registration: registered (user confirmed Oct 11); team/focus category still
  verify — Gate 0 blocks submission, not work.
- Reconstruction quality/latency: an honest proxy is the failure fallback,
  not the visual hero or a substitute for an authored object.
- Judge prompts off-domain (§9.4): scoped generic scene or honest refusal —
  never a hallucinated SKU.
- Authenticity: flags and disqualifiers only — no guarantee.
- Live-credibility claims: current site shows $0 and a simulated tape —
  label simulation everywhere; no live-transaction claims.
- Demo rot during evaluation (§6.3): keep the judge path dependency-light,
  monitor through judging.

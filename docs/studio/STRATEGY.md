# AI Builder Hackathon 2026 — SnapFlip Studio Strategy

Internal strategy doc. Goal: **aim to win** the Victoria VR AI Builder
Hackathon 2026. Existing SnapFlip is treated as prototype/foundation; this
entry requires substantial new product, UX, and visual execution — not a
minimal `/lab` add-on. Dates below are internal targets, not promises. No
submission-field copy is authored here. No claim of a guaranteed win.

This is the plan. What is actually built and verified lives in
[STATUS.md](STATUS.md) — update that file as work lands, not this one.

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

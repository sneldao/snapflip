import {
  SAMPLE_SPEC,
  evaluateDecision,
  validateSpec,
  type StudioCondition,
  type StudioSpec,
} from "./scene";
import { createAudio } from "./audio";
import { CHAPTERS, RAKING_THETA } from "./world/chapters";
import { WorldController } from "./world/WorldController";

const CONDS_BY_OBJECT: Record<StudioSpec["object"], StudioCondition[]> = {
  cartridge: ["clean", "worn", "torn"],
  generic: ["clean", "worn", "chipped"],
};

const OBJECT_NAMES: Record<StudioSpec["object"], string> = {
  cartridge: "cartridge proxy",
  generic: "object proxy",
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stageEl = el<HTMLDivElement>("stage");
const markersEl = el<HTMLDivElement>("markers");
const decisionCard = el<HTMLDivElement>("decision");
const verdictEl = el<HTMLDivElement>("verdict");
const whyEl = el<HTMLDivElement>("why");
const priceEl = el<HTMLDivElement>("price");
const errEl = el<HTMLDivElement>("model-error");
const promptEl = el<HTMLTextAreaElement>("prompt");
const sendBtn = el<HTMLButtonElement>("send");
const undoBtn = el<HTMLButtonElement>("undo");
const ruleBtn = el<HTMLButtonElement>("rule-toggle");
const evCard = el<HTMLDivElement>("evidence-card");
const evTitle = el<HTMLDivElement>("ev-title");
const evDetail = el<HTMLDivElement>("ev-detail");
const provItem = el<HTMLElement>("prov-item");
const provPhotos = el<HTMLElement>("prov-photos");
const photoInput = el<HTMLInputElement>("photo-input");
const photoList = el<HTMLDivElement>("photo-list");
const photoClear = el<HTMLButtonElement>("photo-clear");
const photoErr = el<HTMLDivElement>("photo-error");
const tlScene = el<HTMLSpanElement>("tl-scene");
const tlCond = el<HTMLSpanElement>("tl-cond");
const tlAgent = el<HTMLSpanElement>("tl-agent");
const drawer = el<HTMLDivElement>("drawer");
const panelDirect = el<HTMLDivElement>("panel-direct");
const panelScenario = el<HTMLDivElement>("panel-scenario");

let spec: StudioSpec = { ...SAMPLE_SPEC };
let condition: StudioCondition = spec.condition;
let selectedMarker = -1;
let chapter = 0;
let splatOn = false;
const undoStack: { spec: StudioSpec; condition: StudioCondition }[] = [];

const params = new URLSearchParams(location.search);
const audio = createAudio();
const hintEl = el<HTMLDivElement>("gesture-hint");
const soundBtn = el<HTMLButtonElement>("btn-sound");
const bootEl = el<HTMLDivElement>("boot");
const bootLine = el<HTMLDivElement>("boot-line");
const bootBar = el<HTMLSpanElement>("boot-bar");
const introEl = el<HTMLDivElement>("intro");
const listingEl = el<HTMLDivElement>("listing");
const listingPromptEl = el<HTMLDivElement>("listing-prompt");
const appraisalEl = el<HTMLDivElement>("appraisal");
const capValEl = el<HTMLDivElement>("cap-val");
const did = { rotate: false, lamp: false, nav: false, click: false };
let introDone = params.get("demo") === "1" || chDeepLink();
let evidenceUnlocked = params.get("ev") !== null;

function chDeepLink() {
  return params.get("ch") !== null;
}

// Director's mode: the judge plants the hidden condition via ?cond=; the
// seller's claim stays on the listing overlay. Dramatic irony as a URL param.
const condParam = params.get("cond");
if (condParam && (CONDS_BY_OBJECT[spec.object] as readonly string[]).includes(condParam)) {
  condition = condParam as StudioCondition;
}
const claimParam = params.get("claim");
if (claimParam) el<HTMLElement>("listing-claim").textContent = claimParam;
if (params.get("rule") === "1") spec = { ...spec, rejectTorn: true, rejectChip: true };

// Cold open: a flat marketplace listing is the first paint — "this is a
// listing today" — then it lifts and the world is already built beneath.
const LISTING_PROMPT = "turn this listing into a world — inspect it, test the claim, let a buyer decide";
let listingDone = params.get("fast") === "1" || chDeepLink();
let listingTypeTimer = 0;
function typeListing() {
  if (reducedMotion) {
    listingPromptEl.textContent = LISTING_PROMPT;
    return;
  }
  let i = 0;
  listingTypeTimer = window.setInterval(() => {
    i++;
    listingPromptEl.textContent = LISTING_PROMPT.slice(0, i);
    if (i >= LISTING_PROMPT.length) clearInterval(listingTypeTimer);
  }, 26);
}
function enterWorld() {
  if (listingDone) return;
  listingDone = true;
  clearInterval(listingTypeTimer);
  listingEl.classList.add("lift");
  setTimeout(() => listingEl.remove(), reducedMotion ? 0 : 900);
  syncIntro();
}
el<HTMLButtonElement>("listing-go").addEventListener("click", enterWorld);
el<HTMLButtonElement>("listing-skip").addEventListener("click", enterWorld);
if (!listingDone) {
  listingEl.hidden = false;
  if (params.get("demo") !== "1") listingPromptEl.textContent = LISTING_PROMPT;
}

function bootStep(pct: number, msg: string, err = false) {
  bootBar.style.width = `${pct}%`;
  bootLine.textContent = msg;
  bootLine.className = `line${err ? " err" : ""}`;
}
function bootDone() {
  bootEl.classList.add("done");
  setTimeout(() => bootEl.remove(), 900);
}
bootStep(25, "waking the renderer");

function syncIntro() {
  introEl.hidden = introDone || !listingDone || CHAPTERS[chapter] !== "discover" || drawer.classList.contains("open");
}

// The ticker: a condition-discounted appraisal animates as the scenario
// moves — stakes made visible, and the number falling is the story.
const COND_FACTOR: Record<StudioCondition, number> = { clean: 1, worn: 0.82, torn: 0.45, chipped: 0.5 };
function appraisalCents() {
  return Math.round(spec.maxCents * COND_FACTOR[condition]);
}
let capShown = -1;
function setAppraisal(cents: number, eligible: boolean) {
  el<HTMLDivElement>("cap-note").textContent = eligible
    ? "scenario appraisal — collector's ceiling"
    : "scenario appraisal — collector walks";
  if (cents === capShown) return;
  if (capShown < 0 || reducedMotion) {
    capShown = cents;
    capValEl.textContent = `$${(cents / 100).toFixed(2)}`;
    return;
  }
  const from = capShown;
  capShown = cents;
  appraisalEl.classList.toggle("down", cents < from);
  appraisalEl.classList.toggle("up", cents > from);
  const t0 = performance.now();
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / 650);
    const v = from + (cents - from) * (p * p * (3 - 2 * p));
    capValEl.textContent = `$${(v / 100).toFixed(2)}`;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
el<HTMLButtonElement>("intro-go").addEventListener("click", () => {
  introDone = true;
  syncIntro();
  setChapter(1);
});

function updateHint() {
  if (drawer.classList.contains("open")) {
    hintEl.hidden = true;
    return;
  }
  let html = "";
  if (CHAPTERS[chapter] === "inspect" && (!did.rotate || !did.lamp || (splatOn && !did.click))) {
    const parts: string[] = [];
    if (!did.rotate) parts.push("drag item to rotate");
    if (!did.lamp) parts.push("drag the lamp to move light");
    if (splatOn && !did.click) parts.push("click the object to pin evidence &middot; click a plate to match its angle");
    html = parts.join(" &middot; ");
  } else if (!did.nav) {
    html = "scroll or pick a chapter to move through the world";
  }
  hintEl.hidden = !html;
  if (html) hintEl.innerHTML = html;
}

let world: WorldController | null = null;
try {
  world = await WorldController.create(stageEl, spec, condition, reducedMotion, {
    legacy: params.get("gpu") === "0",
    forceWebGL: params.get("gl2") === "1",
    postFx: params.get("fx") !== "0",
  });
  (window as unknown as { __world?: WorldController }).__world = world ?? undefined;
  bootStep(80, "carving the world");
} catch {
  el<HTMLDivElement>("webgl-fallback").style.display = "block";
  bootStep(100, "renderer unavailable — controls still work", true);
  setTimeout(bootDone, 1600);
}

const markerBtns: HTMLButtonElement[] = [];
for (let i = 0; i < 2; i++) {
  const b = document.createElement("button");
  b.className = "marker";
  b.type = "button";
  b.innerHTML = `<span class="dot"></span><span></span>`;
  const idx = i;
  b.addEventListener("click", () => selectMarker(idx));
  markersEl.appendChild(b);
  markerBtns.push(b);
}
function markerBindings() {
  return markerBtns.map((el, i) => ({ el, gated: i > 0 && !evidenceUnlocked }));
}
world?.setMarkers(markerBindings());
if (world) {
  world.onLampSettled = (side) => {
    if (side !== spec.lightSide) {
      pushUndo();
      spec = { ...spec, lightSide: side };
      syncChips();
      refreshDecision();
    }
  };
  world.onEvidencePinned = () => {
    did.click = true;
    updateHint();
    selectMarker(0);
  };
  world.onPlateAlign = () => {
    did.click = true;
    updateHint();
  };
  world.onDrag = (kind) => {
    if (kind === "item") did.rotate = true;
    else did.lamp = true;
    updateHint();
  };
  world.onGavel = () => audio.gavel();
  world.setPodPop?.((i) => audio.tick(i));
}

soundBtn.setAttribute("aria-pressed", String(audio.enabled()));
soundBtn.textContent = audio.enabled() ? "Sound on" : "Muted";
soundBtn.addEventListener("click", () => {
  const on = audio.toggle();
  soundBtn.setAttribute("aria-pressed", String(on));
  soundBtn.textContent = on ? "Sound on" : "Muted";
});

function objectLabel() {
  return splatOn ? `photo reconstruction (splat), demo` : `demo ${OBJECT_NAMES[spec.object]}`;
}

function selectMarker(i: number) {
  selectedMarker = i;
  if (!evidenceUnlocked) {
    evidenceUnlocked = true;
    world?.unlockEvidence();
  }
  audio.click();
  world?.setEvidenceFocus(i);
  evTitle.textContent = markerBtns[i].querySelector("span:last-child")?.textContent ?? "evidence";
  evDetail.textContent = `${objectLabel()} · ${condition} scenario, unverified · simulated evidence, not an observed condition`;
  evCard.hidden = false;
}

function refreshDecision() {
  const d = evaluateDecision(spec, condition);
  verdictEl.textContent = d.eligible ? "Collector stays in" : "Collector walks away";
  verdictEl.className = `verdict ${d.eligible ? "in" : "out"}`;
  whyEl.textContent = d.reason;
  priceEl.textContent = `cap $${(d.limitCents / 100).toFixed(2)} · simulated decision`;
  setAppraisal(appraisalCents(), d.eligible);
  tlScene.textContent = spec.title;
  tlCond.textContent = condition;
  tlAgent.textContent = d.eligible ? "in" : "out";
  world?.setSignal(d.eligible);
  world?.setRationale(d.eligible ? null : d.reason);
}

function showError(msg: string) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

function pushUndo() {
  undoStack.push({ spec: { ...spec }, condition });
  undoBtn.disabled = false;
}

function restore(specIn: StudioSpec, condIn: StudioCondition) {
  spec = specIn;
  condition = condIn;
  syncChips();
  world?.applySpec(spec, condition);
  world?.setMarkers(markerBindings());
  if (selectedMarker >= 0) selectMarker(selectedMarker);
  refreshDecision();
}

function applySpec(next: StudioSpec) {
  pushUndo();
  restore(next, next.condition);
}

function syncChips() {
  const allowed = CONDS_BY_OBJECT[spec.object];
  document.querySelectorAll<HTMLButtonElement>("[data-cond]").forEach((b) => {
    const c = b.dataset.cond as StudioCondition;
    b.hidden = !allowed.includes(c);
    b.setAttribute("aria-pressed", String(c === condition));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-light]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.light === spec.lightSide));
  });
  const ruleOn = spec.object === "cartridge" ? spec.rejectTorn : spec.rejectChip;
  ruleBtn.setAttribute("aria-pressed", String(ruleOn));
  ruleBtn.textContent =
    spec.object === "cartridge" ? "reject if label torn (simulated)" : "reject if chipped (simulated)";
  provItem.textContent = objectLabel();
}

function setChapter(i: number) {
  chapter = i;
  did.nav = true;
  if (CHAPTERS[i] !== "discover") introDone = true;
  audio.whoosh();
  audio.setChapter(CHAPTERS[i]);
  world?.setChapter(i);
  syncIntro();
  updateHint();
  if (CHAPTERS[i] === "auction") world?.setEvidenceFocus(selectedMarker >= 0 ? selectedMarker : null);
  document.querySelectorAll<HTMLButtonElement>("[data-ch]").forEach((b) => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.ch) === i));
  });
  decisionCard.hidden = CHAPTERS[i] !== "auction";
  appraisalEl.hidden = CHAPTERS[i] === "discover";
  if (CHAPTERS[i] !== "inspect") {
    evCard.hidden = true;
    selectedMarker = -1;
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-ch]").forEach((b) => {
  b.addEventListener("click", () => setChapter(Number(b.dataset.ch)));
});

// Wheel/trackpad advances chapters (scroll as the narrative device); in the
// Atelier wheel stays on OrbitControls zoom. Cooldown absorbs trackpad inertia.
let wheelAcc = 0;
let wheelLockUntil = 0;
stageEl.addEventListener(
  "wheel",
  (e) => {
    if (CHAPTERS[chapter] === "inspect") return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLockUntil) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 60) return;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    const next = Math.min(CHAPTERS.length - 1, Math.max(0, chapter + dir));
    if (next === chapter) return;
    wheelLockUntil = now + 750;
    setChapter(next);
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const t = e.target as HTMLElement;
  if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
  const next = Math.min(CHAPTERS.length - 1, Math.max(0, chapter + (e.key === "ArrowRight" ? 1 : -1)));
  if (next !== chapter) setChapter(next);
});

el<HTMLButtonElement>("btn-reset").addEventListener("click", () => setChapter(chapter));

function toggleDrawer(which: "direct" | "scenario") {
  const showDirect = which === "direct" && panelDirect.hidden;
  const showScenario = which === "scenario" && panelScenario.hidden;
  panelDirect.hidden = !showDirect;
  panelScenario.hidden = !showScenario;
  drawer.classList.toggle("open", showDirect || showScenario);
  el<HTMLButtonElement>("btn-direct").setAttribute("aria-pressed", String(showDirect));
  el<HTMLButtonElement>("btn-scenario").setAttribute("aria-pressed", String(showScenario));
  syncIntro();
  updateHint();
}

el<HTMLButtonElement>("btn-direct").addEventListener("click", () => toggleDrawer("direct"));
el<HTMLButtonElement>("btn-scenario").addEventListener("click", () => toggleDrawer("scenario"));

document.querySelectorAll<HTMLButtonElement>("[data-cond]").forEach((b) => {
  b.addEventListener("click", () => {
    pushUndo();
    condition = b.dataset.cond as StudioCondition;
    syncChips();
    world?.setCondition(spec, condition);
    if (selectedMarker >= 0) selectMarker(selectedMarker);
    refreshDecision();
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-light]").forEach((b) => {
  b.addEventListener("click", () => {
    pushUndo();
    spec = { ...spec, lightSide: b.dataset.light as StudioSpec["lightSide"] };
    syncChips();
    world?.applySpec(spec, condition);
    refreshDecision();
  });
});

ruleBtn.addEventListener("click", () => {
  pushUndo();
  spec =
    spec.object === "cartridge"
      ? { ...spec, rejectTorn: !spec.rejectTorn }
      : { ...spec, rejectChip: !spec.rejectChip };
  syncChips();
  refreshDecision();
});

const sourcePhotos: string[] = [];

function renderPhotos() {
  photoList.innerHTML = "";
  for (const url of sourcePhotos) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "uploaded source photo, unverified";
    photoList.appendChild(img);
  }
  photoClear.hidden = sourcePhotos.length === 0;
  provPhotos.textContent =
    sourcePhotos.length === 0 ? "no source photos" : `${sourcePhotos.length} source photo${sourcePhotos.length > 1 ? "s" : ""}, unverified`;
}

function photoError(msg: string) {
  photoErr.textContent = msg;
  photoErr.hidden = false;
}

if (photoInput && photoClear && photoList) {
  photoInput.addEventListener("change", async () => {
    const files = Array.from(photoInput.files ?? []).slice(0, Math.max(0, 4 - sourcePhotos.length));
    photoInput.value = "";
    photoErr.hidden = true;
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        photoError(`"${file.name}" exceeds 8MB — skipped.`);
        continue;
      }
      try {
        const res = await fetch("/api/studio/photos", {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          photoError(`"${file.name}": ${data.error ?? `upload failed (${res.status})`}`);
          continue;
        }
        sourcePhotos.push(data.url);
      } catch {
        photoError(`"${file.name}": upload failed (network).`);
      }
    }
    renderPhotos();
    world?.setSourcePhotos(sourcePhotos);
    if (sourcePhotos.length > 0) audio.slide();
  });

  photoClear.addEventListener("click", () => {
    sourcePhotos.length = 0;
    photoErr.hidden = true;
    renderPhotos();
    world?.setSourcePhotos([]);
  });
}

el<HTMLButtonElement>("load-sample").addEventListener("click", () => {
  errEl.hidden = true;
  applySpec({ ...SAMPLE_SPEC });
});

undoBtn.addEventListener("click", () => {
  const prev = undoStack.pop();
  if (!prev) return;
  restore(prev.spec, prev.condition);
  undoBtn.disabled = undoStack.length === 0;
});

el<HTMLFormElement>("director-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const instruction = promptEl.value.trim();
  if (!instruction) return;
  errEl.hidden = true;
  sendBtn.disabled = true;
  try {
    const res = await fetch("/api/studio/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction, previous: spec }),
    });
    const data = (await res.json()) as { spec?: unknown; error?: string };
    if (!res.ok) {
      showError(
        `Scene model unavailable (${res.status}): ${data.error ?? "request failed"}. The loaded scene still works — edit scenario controls or load the sample.`,
      );
      return;
    }
    const next = validateSpec(data.spec);
    if (!next) {
      showError("Model returned an unusable scene spec; the current scene is unchanged.");
      return;
    }
    applySpec(next);
  } catch {
    showError("Network error reaching the scene model; the current scene is unchanged.");
  } finally {
    sendBtn.disabled = false;
  }
});

const chIdx = (CHAPTERS as readonly string[]).indexOf(params.get("ch") ?? "");
syncChips();
setChapter(chIdx >= 0 ? chIdx : 0);
refreshDecision();
const evIdx = Number.parseInt(params.get("ev") ?? "", 10);
if (Number.isInteger(evIdx) && evIdx >= 0 && evIdx < markerBtns.length) {
  world?.setEvidenceFocus(evIdx);
}
updateHint();

const envUrl = params.get("env");
if (envUrl && world) {
  world.attachEnvSplat(envUrl);
}

const splatUrl = params.get("splat");
if (splatUrl && world) {
  world.attachSplat(splatUrl).then((ok) => {
    if (ok) {
      splatOn = true;
      const badge = el<HTMLElement>("prov-badge");
      const credit = params.get("credit");
      badge.textContent = credit ? `photo reconstruction · ${credit}` : "photo reconstruction";
      syncChips();
      updateHint();
    }
  });
}

syncIntro();
if (world) {
  bootStep(100, "entering the racks");
  setTimeout(bootDone, 350);
}

// ?demo=1 — scripted showcase in three acts: the claim (listing lifts) → the
// scrutiny (raking light, spin, pinned evidence, the planted condition) → the
// verdict (pods pop, gavel falls, basis card, arc). &loop=0 holds the verdict.
function spinItem(speed: number, ms: number) {
  const t0 = performance.now();
  const tick = () => {
    world?.setItemRotation((world.itemRotation ?? 0) + speed * 0.016);
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function demoBeats() {
  const steps: [number, () => void][] = [
    [400, () => setChapter(1)],
    [2600, () => world?.nudgeLamp(RAKING_THETA.left, 1500)],
    [4300, () => spinItem(0.5, 1800)],
    [6400, () => selectMarker(0)],
    [8000, () => document.querySelector<HTMLButtonElement>('[data-cond="torn"]')?.click()],
    [9200, () => {
      if (ruleBtn.getAttribute("aria-pressed") !== "true") ruleBtn.click();
    }],
    [10800, () => setChapter(2)],
    [
      24000,
      () => {
        if (params.get("loop") === "0") return;
        setChapter(0);
        setTimeout(demoBeats, 4200);
      },
    ],
  ];
  for (const [dt, fn] of steps) setTimeout(fn, dt);
}
if (params.get("demo") === "1" && world) {
  if (!listingDone) {
    typeListing();
    setTimeout(enterWorld, 3400);
    setTimeout(demoBeats, 5600);
  } else {
    setTimeout(demoBeats, 1200);
  }
}

if (params.has("debug") && world) {
  const diag = el<HTMLDivElement>("diag");
  diag.hidden = false;
  setInterval(() => {
    const d = world?.diagnostics();
    if (!d) return;
    diag.textContent = `gpu   ${d.backend}\ncalls ${d.calls}\ntris  ${d.triangles}\ngeo   ${d.geometries}\ntex   ${d.textures}\nprogs ${d.programs}\ndpr   ${d.dpr}`;
  }, 500);
}

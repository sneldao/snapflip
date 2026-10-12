import {
  SAMPLE_SPEC,
  decodeScene,
  encodeScene,
  evaluateDecision,
  validateSpec,
  type StudioCondition,
  type StudioSpec,
} from "./scene";
import { createAudio } from "./audio";
import { CHAPTERS, RAKING_THETA } from "./world/chapters";
import { WorldController } from "./world/WorldController";
import { ITEM_STEP, LAMP_STEP, focusCard, hintFor } from "./ux";

const CONDS_BY_OBJECT: Record<StudioSpec["object"], StudioCondition[]> = {
  cartridge: ["clean", "worn", "torn"],
  generic: ["clean", "worn", "chipped"],
};

const OBJECT_NAMES: Record<StudioSpec["object"], string> = {
  cartridge: "cartridge proxy",
  generic: "object proxy",
};

const COND_FACTOR: Record<StudioCondition, number> = { clean: 1, worn: 0.82, torn: 0.45, chipped: 0.5 };

const LISTING_PROMPT = "turn this listing into a world — inspect it, test the claim, let a buyer decide";

type Snapshot = { spec: StudioSpec; condition: StudioCondition };
type Drawer = "direct" | "scenario" | null;

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
const capValEl = el<HTMLSpanElement>("cap-val");
const capNoteEl = el<HTMLSpanElement>("cap-note");
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
const provBadge = el<HTMLElement>("prov-badge");
const photoInput = el<HTMLInputElement>("photo-input");
const photoList = el<HTMLDivElement>("photo-list");
const photoClear = el<HTMLButtonElement>("photo-clear");
const photoErr = el<HTMLDivElement>("photo-error");
const tlScene = el<HTMLSpanElement>("tl-scene");
const tlCond = el<HTMLSpanElement>("tl-cond");
const tlAgent = el<HTMLSpanElement>("tl-agent");
const drawerEl = el<HTMLDivElement>("drawer");
const panelDirect = el<HTMLDivElement>("panel-direct");
const panelScenario = el<HTMLDivElement>("panel-scenario");
const hintEl = el<HTMLDivElement>("gesture-hint");
const soundBtn = el<HTMLButtonElement>("btn-sound");
const bootEl = el<HTMLDivElement>("boot");
const bootLine = el<HTMLDivElement>("boot-line");
const bootBar = el<HTMLSpanElement>("boot-bar");
const introEl = el<HTMLDivElement>("intro");
const listingEl = el<HTMLDivElement>("listing");
const listingPromptEl = el<HTMLDivElement>("listing-prompt");
const beatEl = el<HTMLDivElement>("beat");
const diagEl = el<HTMLDivElement>("diag");
const markerBtns: HTMLButtonElement[] = [];
const toastEl = el<HTMLDivElement>("toast");
const toastText = el<HTMLSpanElement>("toast-text");
const toastUndo = el<HTMLButtonElement>("toast-undo");

const params = new URLSearchParams(location.search);
const audio = createAudio();

// One store: everything on screen and in the world is derived from this.
const state = {
  spec: { ...SAMPLE_SPEC } as StudioSpec,
  condition: SAMPLE_SPEC.condition as StudioCondition,
  chapter: 0,
  selectedMarker: -1,
  splatOn: false,
  evidenceUnlocked: params.get("ev") !== null,
  introDone: params.get("demo") === "1" || params.has("ch"),
  listingDone: params.get("fast") === "1" || params.has("ch"),
  drawer: null as Drawer,
  sourcePhotos: [] as string[],
};

// What the user has already done; drives the single hint line.
const did = { rotate: false, lamp: false, nav: false, click: false };
const undoStack: Snapshot[] = [];

// Director's mode: the judge plants the hidden condition via ?cond=; the
// seller's claim stays on the listing overlay.
const condParam = params.get("cond");
if (condParam && (CONDS_BY_OBJECT[state.spec.object] as readonly string[]).includes(condParam)) {
  state.condition = condParam as StudioCondition;
}
const claimParam = params.get("claim");
if (claimParam) el<HTMLElement>("listing-claim").textContent = claimParam;
if (params.get("rule") === "1") state.spec = { ...state.spec, rejectTorn: true, rejectChip: true };

// A shared link (?scene=) restores the exact scene; anything invalid is ignored.
const shared = decodeScene(params.get("scene"));
if (shared) {
  state.spec = shared.spec;
  state.condition = shared.condition;
}

// ---------- narrator, listing, boot ----------

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
  if (state.listingDone) return;
  state.listingDone = true;
  clearInterval(listingTypeTimer);
  listingEl.classList.add("lift");
  setTimeout(() => listingEl.remove(), reducedMotion ? 0 : 900);
  render();
  setTimeout(() => beat("The seller said mint."), reducedMotion ? 0 : 800);
}

// Beat cards stitch the three acts into a story. First visit only.
let beatTimer = 0;
function beat(text: string, hold = 2800) {
  beatEl.textContent = text;
  beatEl.classList.add("show");
  clearTimeout(beatTimer);
  beatTimer = window.setTimeout(() => beatEl.classList.remove("show"), hold);
}
const seenChapters = new Set<number>([0]);

el<HTMLButtonElement>("listing-go").addEventListener("click", enterWorld);
el<HTMLButtonElement>("listing-skip").addEventListener("click", enterWorld);
if (!state.listingDone) {
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

// ---------- demo autopilot (cancellable) ----------

// ?demo=1 scripts three acts. Every step is tracked so that any real user
// input cancels the rest of the script instead of fighting the user's state.
let demoActive = params.get("demo") === "1";
const demoTimers: number[] = [];
function demoAfter(fn: () => void, ms: number) {
  demoTimers.push(window.setTimeout(fn, ms));
}
function cancelDemo() {
  if (!demoActive) return;
  demoActive = false;
  for (const t of demoTimers) clearTimeout(t);
  demoTimers.length = 0;
}
window.addEventListener("pointerdown", cancelDemo, true);

// ---------- world ----------

let world: WorldController | null = null;
try {
  world = await WorldController.create(stageEl, state.spec, state.condition, reducedMotion, {
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

for (let i = 0; i < 2; i++) {
  const b = document.createElement("button");
  b.className = "marker";
  b.type = "button";
  b.innerHTML = `<span class="dot"></span><span></span>`;
  b.addEventListener("click", () => selectMarker(i));
  markersEl.appendChild(b);
  markerBtns.push(b);
}

function markerBindings() {
  return markerBtns.map((el, i) => ({ el, gated: i > 0 && !state.evidenceUnlocked }));
}

world?.setMarkers(markerBindings());
if (world) {
  world.onLampSettled = (side) => {
    if (side !== state.spec.lightSide) {
      haptic(10);
      commit({ spec: { ...state.spec, lightSide: side }, condition: state.condition }, "ui", "moved the light");
    }
  };
  world.onEvidencePinned = () => {
    did.click = true;
    haptic(12);
    selectMarker(0);
  };
  world.onPlateAlign = () => {
    did.click = true;
    render();
  };
  // The first reveal of damage gets a camera kick and opens the evidence card.
  let revealPlayed = false;
  world.onDrag = (kind) => {
    if (kind === "item") {
      did.rotate = true;
    } else {
      did.lamp = true;
      if (!revealPlayed && state.condition !== "clean") {
        revealPlayed = true;
        world?.pulse();
        audio.tick(0);
        setTimeout(() => {
          if (CHAPTERS[state.chapter] === "inspect") selectMarker(0);
        }, 450);
      }
    }
    render();
  };
  world.onGavel = () => audio.gavel();
  world.setPodPop?.((i) => audio.tick(i));
  world.setMaraStep(() => audio.thud());
}

soundBtn.setAttribute("aria-pressed", String(audio.enabled()));
soundBtn.textContent = audio.enabled() ? "Sound on" : "Muted";
soundBtn.addEventListener("click", () => {
  const on = audio.toggle();
  soundBtn.setAttribute("aria-pressed", String(on));
  soundBtn.textContent = on ? "Sound on" : "Muted";
});

// ---------- state changes ----------

// Every state change goes through here: push undo (if asked), apply to the
// world when the spec or condition changed, then re-render the UI.
function commit(next: Snapshot, mode: "spec" | "condition" | "ui", label: string) {
  undoStack.push({ spec: state.spec, condition: state.condition });
  undoBtn.disabled = false;
  apply(next, mode);
  render();
  showToast(label, true);
}

let toastTimer = 0;
function showToast(text: string, undoable: boolean) {
  toastText.textContent = text;
  toastUndo.hidden = !undoable || undoStack.length === 0;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

// Light haptic confirmation where the device supports it.
function haptic(ms: number) {
  if ("vibrate" in navigator) navigator.vibrate(ms);
}

function apply(next: Snapshot, mode: "spec" | "condition" | "ui") {
  state.spec = next.spec;
  state.condition = next.condition;
  if (mode === "spec") {
    world?.applySpec(state.spec, state.condition);
    world?.setMarkers(markerBindings());
  } else if (mode === "condition") {
    world?.setCondition(state.spec, state.condition);
  }
}

function selectMarker(i: number) {
  state.selectedMarker = i;
  if (!state.evidenceUnlocked) {
    state.evidenceUnlocked = true;
    world?.unlockEvidence();
  }
  audio.click();
  world?.setEvidenceFocus(i);
  render();
}

function goChapter(i: number) {
  state.chapter = i;
  if (CHAPTERS[i] !== "discover") state.introDone = true;
  audio.whoosh();
  audio.setChapter(CHAPTERS[i]);
  world?.setChapter(i);
  if (CHAPTERS[i] === "auction") world?.setEvidenceFocus(state.selectedMarker >= 0 ? state.selectedMarker : null);
  if (CHAPTERS[i] !== "inspect") state.selectedMarker = -1;
  if (!seenChapters.has(i)) {
    seenChapters.add(i);
    if (CHAPTERS[i] === "inspect") {
      setTimeout(() => beat("The light doesn't lie."), reducedMotion ? 0 : 800);
    } else if (CHAPTERS[i] === "auction") {
      setTimeout(() => beat("Now the collector decides."), reducedMotion ? 0 : 800);
      setTimeout(() => {
        const d = evaluateDecision(state.spec, state.condition);
        beat(d.eligible ? "The claim holds — this time." : "And the claim doesn't survive.", 3400);
      }, reducedMotion ? 1200 : 4800);
    }
  }
  render();
}

// A user-initiated chapter change: also counts as navigation for the hint.
function userGoChapter(i: number) {
  did.nav = true;
  goChapter(i);
}

function stepChapter(dir: -1 | 1) {
  const next = Math.min(CHAPTERS.length - 1, Math.max(0, state.chapter + dir));
  if (next !== state.chapter) userGoChapter(next);
}

// ---------- rendering ----------

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const objectLabel = () => (state.splatOn ? "photo reconstruction (splat), demo" : `demo ${OBJECT_NAMES[state.spec.object]}`);

let capShown = -1;
function setAppraisal(cents: number, eligible: boolean) {
  capNoteEl.textContent = eligible ? "scenario appraisal — collector's ceiling" : "scenario appraisal — collector walks";
  if (cents === capShown) return;
  if (capShown < 0 || reducedMotion) {
    capShown = cents;
    capValEl.textContent = money(cents);
    return;
  }
  const from = capShown;
  capShown = cents;
  decisionCard.classList.toggle("down", cents < from);
  decisionCard.classList.toggle("up", cents > from);
  const t0 = performance.now();
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / 650);
    const v = from + (cents - from) * (p * p * (3 - 2 * p));
    capValEl.textContent = money(v);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Only send signal/rationale changes to the world when they actually change,
// so re-renders do not restart pod or gavel animations.
let lastSignal: boolean | null = null;
let lastRationale: string | null | undefined;

function renderDecision() {
  const d = evaluateDecision(state.spec, state.condition);
  verdictEl.textContent = d.eligible ? "Collector stays in" : "Collector walks away";
  verdictEl.className = `verdict ${d.eligible ? "in" : "out"}`;
  whyEl.textContent = d.reason;
  priceEl.textContent = `cap ${money(d.limitCents)} · simulated decision`;
  setAppraisal(Math.round(state.spec.maxCents * COND_FACTOR[state.condition]), d.eligible);
  tlScene.textContent = state.spec.title;
  tlCond.textContent = state.condition;
  tlAgent.textContent = d.eligible ? "in" : "out";
  if (d.eligible !== lastSignal) {
    lastSignal = d.eligible;
    world?.setSignal(d.eligible);
  }
  const rationale = d.eligible ? null : d.reason;
  if (rationale !== lastRationale) {
    lastRationale = rationale;
    world?.setRationale(rationale);
  }
}

function syncChips() {
  const allowed = CONDS_BY_OBJECT[state.spec.object];
  document.querySelectorAll<HTMLButtonElement>("[data-cond]").forEach((b) => {
    const c = b.dataset.cond as StudioCondition;
    b.hidden = !allowed.includes(c);
    b.setAttribute("aria-pressed", String(c === state.condition));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-light]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.light === state.spec.lightSide));
  });
  const ruleOn = state.spec.object === "cartridge" ? state.spec.rejectTorn : state.spec.rejectChip;
  ruleBtn.setAttribute("aria-pressed", String(ruleOn));
  ruleBtn.textContent = state.spec.object === "cartridge" ? "reject if label torn (simulated)" : "reject if chipped (simulated)";
  provItem.textContent = objectLabel();
}

function updateHint() {
  const text = hintFor({
    chapter: CHAPTERS[state.chapter],
    drawerOpen: state.drawer !== null,
    didRotate: did.rotate,
    didLamp: did.lamp,
    didNav: did.nav,
    splatOn: state.splatOn,
    didClick: did.click,
  });
  hintEl.hidden = !text;
  hintEl.textContent = text ?? "";
}

function renderEvidence() {
  const i = state.selectedMarker;
  evTitle.textContent = markerBtns[i]?.querySelector("span:last-child")?.textContent ?? "evidence";
  evDetail.textContent = `${objectLabel()} · ${state.condition} scenario, unverified · simulated evidence, not an observed condition`;
}

// The one place the DOM is written from state. Safe to call at any time.
function render() {
  const ch = CHAPTERS[state.chapter];
  const focus = focusCard({
    chapter: ch,
    introDone: state.introDone,
    listingDone: state.listingDone,
    drawerOpen: state.drawer !== null,
    selectedMarker: state.selectedMarker,
  });
  introEl.hidden = focus !== "intro";
  evCard.hidden = focus !== "evidence";
  decisionCard.hidden = focus !== "decision";
  if (focus === "evidence") renderEvidence();

  panelDirect.hidden = state.drawer !== "direct";
  panelScenario.hidden = state.drawer !== "scenario";
  drawerEl.classList.toggle("open", state.drawer !== null);
  el<HTMLButtonElement>("btn-direct").setAttribute("aria-pressed", String(state.drawer === "direct"));
  el<HTMLButtonElement>("btn-scenario").setAttribute("aria-pressed", String(state.drawer === "scenario"));

  document.querySelectorAll<HTMLButtonElement>("[data-ch]").forEach((b) => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.ch) === state.chapter));
  });
  syncChips();
  renderDecision();
  updateHint();
}

// ---------- DOM events ----------

document.querySelectorAll<HTMLButtonElement>("[data-ch]").forEach((b) => {
  b.addEventListener("click", () => userGoChapter(Number(b.dataset.ch)));
});

el<HTMLButtonElement>("intro-go").addEventListener("click", () => {
  state.introDone = true;
  userGoChapter(1);
});

// Shift + scroll advances chapters. Plain scroll is left alone so the page
// and the Atelier's OrbitControls zoom behave normally.
let wheelAcc = 0;
let wheelLockUntil = 0;
stageEl.addEventListener(
  "wheel",
  (e) => {
    if (!e.shiftKey || CHAPTERS[state.chapter] === "inspect") return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLockUntil) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 60) return;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    const next = Math.min(CHAPTERS.length - 1, Math.max(0, state.chapter + dir));
    if (next === state.chapter) return;
    wheelLockUntil = now + 750;
    did.nav = true;
    goChapter(next);
  },
  { passive: false },
);

// Keyboard: arrows move the lamp and turn the item in the Atelier, and change
// chapter elsewhere. [ and ] change chapter everywhere.
window.addEventListener("keydown", (e) => {
  cancelDemo();
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target as HTMLElement;
  if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
  if (e.key === "[") return stepChapter(-1);
  if (e.key === "]") return stepChapter(1);
  if (CHAPTERS[state.chapter] === "inspect") {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      world?.nudgeLampBy((e.key === "ArrowRight" ? 1 : -1) * LAMP_STEP);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      world?.rotateItemBy((e.key === "ArrowUp" ? 1 : -1) * ITEM_STEP);
      return;
    }
  }
  if (e.key === "ArrowRight") stepChapter(1);
  if (e.key === "ArrowLeft") stepChapter(-1);
});

el<HTMLButtonElement>("btn-reset").addEventListener("click", () => userGoChapter(state.chapter));

function toggleDrawer(which: "direct" | "scenario") {
  state.drawer = state.drawer === which ? null : which;
  render();
}

el<HTMLButtonElement>("btn-direct").addEventListener("click", () => toggleDrawer("direct"));
el<HTMLButtonElement>("btn-scenario").addEventListener("click", () => toggleDrawer("scenario"));

document.querySelectorAll<HTMLButtonElement>("[data-cond]").forEach((b) => {
  b.addEventListener("click", () => {
    commit({ spec: state.spec, condition: b.dataset.cond as StudioCondition }, "condition", `condition ${b.dataset.cond}`);
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-light]").forEach((b) => {
  b.addEventListener("click", () => {
    commit(
      { spec: { ...state.spec, lightSide: b.dataset.light as StudioSpec["lightSide"] }, condition: state.condition },
      "spec",
      `light ${b.dataset.light}`,
    );
  });
});

ruleBtn.addEventListener("click", () => {
  const spec: StudioSpec =
    state.spec.object === "cartridge"
      ? { ...state.spec, rejectTorn: !state.spec.rejectTorn }
      : { ...state.spec, rejectChip: !state.spec.rejectChip };
  commit({ spec, condition: state.condition }, "ui", "rule changed");
});

function renderPhotos() {
  photoList.innerHTML = "";
  for (const url of state.sourcePhotos) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "uploaded source photo, unverified";
    photoList.appendChild(img);
  }
  photoClear.hidden = state.sourcePhotos.length === 0;
  provPhotos.textContent =
    state.sourcePhotos.length === 0
      ? "no source photos"
      : `${state.sourcePhotos.length} source photo${state.sourcePhotos.length > 1 ? "s" : ""}, unverified`;
}

function photoError(msg: string) {
  photoErr.textContent = msg;
  photoErr.hidden = false;
}

if (photoInput && photoClear && photoList) {
  photoInput.addEventListener("change", async () => {
    const files = Array.from(photoInput.files ?? []).slice(0, Math.max(0, 4 - state.sourcePhotos.length));
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
        state.sourcePhotos.push(data.url);
      } catch {
        photoError(`"${file.name}": upload failed (network).`);
      }
    }
    renderPhotos();
    world?.setSourcePhotos(state.sourcePhotos);
    if (state.sourcePhotos.length > 0) audio.slide();
  });

  photoClear.addEventListener("click", () => {
    state.sourcePhotos.length = 0;
    photoErr.hidden = true;
    renderPhotos();
    world?.setSourcePhotos([]);
  });
}

el<HTMLButtonElement>("load-sample").addEventListener("click", () => {
  errEl.hidden = true;
  commit({ spec: { ...SAMPLE_SPEC }, condition: SAMPLE_SPEC.condition }, "spec", "loaded sample");
});

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  apply(prev, "spec");
  undoBtn.disabled = undoStack.length === 0;
  render();
}

undoBtn.addEventListener("click", undo);
toastUndo.addEventListener("click", () => {
  undo();
  toastEl.hidden = true;
});

el<HTMLButtonElement>("btn-share").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.searchParams.set("scene", encodeScene(state.spec, state.condition));
  url.searchParams.set("ch", CHAPTERS[state.chapter]);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast("link copied", false);
  } catch {
    history.replaceState(null, "", url.toString());
    showToast("copy blocked — link is in the address bar", false);
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-suggest]").forEach((b) => {
  b.addEventListener("click", () => {
    promptEl.value = b.dataset.suggest ?? "";
    el<HTMLFormElement>("director-form").requestSubmit();
  });
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
      body: JSON.stringify({ instruction, previous: state.spec }),
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
    commit({ spec: next, condition: next.condition }, "spec", "new scene");
  } catch {
    showError("Network error reaching the scene model; the current scene is unchanged.");
  } finally {
    sendBtn.disabled = false;
  }
});

function showError(msg: string) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

// ---------- boot ----------

syncChips();
const chIdx = (CHAPTERS as readonly string[]).indexOf(params.get("ch") ?? "");
goChapter(chIdx >= 0 ? chIdx : 0);
const evIdx = Number.parseInt(params.get("ev") ?? "", 10);
if (Number.isInteger(evIdx) && evIdx >= 0 && evIdx < markerBtns.length) {
  world?.setEvidenceFocus(evIdx);
}
render();

const envUrl = params.get("env");
if (envUrl && world) {
  world.attachEnvSplat(envUrl);
}

const splatUrl = params.get("splat");
if (splatUrl && world) {
  world.attachSplat(splatUrl).then((ok) => {
    if (!ok) return;
    state.splatOn = true;
    const credit = params.get("credit");
    provBadge.textContent = credit ? `photo reconstruction · ${credit}` : "photo reconstruction";
    render();
  });
}

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
    [400, () => goChapter(1)],
    [2600, () => world?.nudgeLamp(RAKING_THETA.left, 1500)],
    [4300, () => spinItem(0.5, 1800)],
    [6400, () => selectMarker(0)],
    [8000, () => document.querySelector<HTMLButtonElement>('[data-cond="torn"]')?.click()],
    [
      9200,
      () => {
        if (ruleBtn.getAttribute("aria-pressed") !== "true") ruleBtn.click();
      },
    ],
    [10800, () => goChapter(2)],
    [
      24000,
      () => {
        if (params.get("loop") === "0") return;
        goChapter(0);
        demoAfter(demoBeats, 4200);
      },
    ],
  ];
  for (const [dt, fn] of steps) demoAfter(fn, dt);
}

if (params.get("demo") === "1" && world) {
  if (!state.listingDone) {
    typeListing();
    demoAfter(enterWorld, 3400);
    demoAfter(demoBeats, 5600);
  } else {
    demoAfter(demoBeats, 1200);
  }
}

if (params.has("debug") && world) {
  diagEl.hidden = false;
  setInterval(() => {
    const d = world?.diagnostics();
    if (!d) return;
    diagEl.textContent = `gpu   ${d.backend}\ncalls ${d.calls}\ntris  ${d.triangles}\ngeo   ${d.geometries}\ntex   ${d.textures}\nprogs ${d.programs}\ndpr   ${d.dpr}`;
  }, 500);
}

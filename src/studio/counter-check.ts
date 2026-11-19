// Counter Check — a counter examiner's paper evidence slip clipped over the
// Atelier. One loop: sweep the real inspection lamp until the tell lights up,
// hold on it, stamp the evidence, then call it. Every figure is fictional and
// nothing here authenticates a real item.
import type { StudioCondition } from "./scene";

export type Call = "buy" | "haggle" | "pass";

const LOTS = [
  {
    id: "07",
    condition: "worn",
    target: 0.43,
    value: 42,
    floor: 26,
    evidence: "Silver rub along the label. The ink is intact.",
    claim: "Near mint. Never left the box.",
  },
  {
    id: "08",
    condition: "torn",
    target: 0.76,
    value: 15,
    floor: 25,
    evidence: "The label is lifted and torn at the corner.",
    claim: "Mint except for the light in the photo.",
  },
  {
    id: "09",
    condition: "clean",
    target: 0.25,
    value: 65,
    floor: 36,
    evidence: "The label edge is flat and unbroken. The glare was the tell.",
    claim: "Clean copy. Firm on price.",
  },
] as const satisfies readonly {
  id: string;
  condition: StudioCondition;
  target: number;
  value: number;
  floor: number;
  evidence: string;
  claim: string;
}[];

const ASK = 38,
  OFFER = 28,
  HAGGLE_COST = 8;

export type CounterLot = (typeof LOTS)[number];
type Lot = CounterLot;

export const getCounterLot = (id: string | null) => LOTS.find((lot) => lot.id === id);

function settle(lot: Lot, call: Call) {
  if (call === "pass") return { net: 0, explanation: "No sale." };
  if (call === "haggle" && OFFER < lot.floor) return { net: 0, explanation: "The seller walked. No sale." };
  const cost = call === "buy" ? ASK : OFFER + HAGGLE_COST;
  return {
    net: lot.value - cost,
    explanation:
      call === "buy"
        ? `Value $${lot.value} less $${ASK} paid.`
        : `Value $${lot.value} less $${OFFER} paid and $${HAGGLE_COST} sourcing cost.`,
  };
}

export interface CounterHooks {
  /** Lamp position along the raking arc, 0..1 — null when no renderer. */
  readSweep(): number | null;
  setSweep(fraction: number): void;
  /** Fired once when the scan lock latches — the tell lights up. */
  onLock(): void;
  onPin(): void;
  onCall(): void;
}

const CALL_LABEL: Record<Call, string> = {
  buy: `Buy $${ASK}`,
  haggle: `Haggle $${OFFER}`,
  pass: "Pass",
};

function bestPlay(lot: Lot): { call: Call; net: number } {
  let best: { call: Call; net: number } = { call: "pass", net: 0 };
  for (const call of ["buy", "haggle"] as const) {
    const r = settle(lot, call);
    if (r.net > best.net) best = { call, net: r.net };
  }
  return best;
}

const money = (n: number) => (n === 0 ? "$0" : `${n < 0 ? "−" : "+"}$${Math.abs(n)}`);

export function mountCounterCheck(root: HTMLElement, lot: Lot, hooks: CounterHooks): void {
  const next = LOTS[(LOTS.indexOf(lot) + 1) % LOTS.length];
  root.innerHTML = `
    <aside class="slip" aria-label="Counter check, lot ${lot.id}">
      <div class="paperclip" aria-hidden="true"></div>
      <header class="slip-head">
        <div class="kicker">Counter check · evidence slip</div>
        <h2 class="lot">Lot ${lot.id}</h2>
        <p class="claim">The seller claims: &ldquo;${lot.claim}&rdquo;</p>
        <p class="terms">ask $${ASK} &middot; offer $${OFFER} + $${HAGGLE_COST} sourcing &middot; fictional figures, not an appraisal</p>
      </header>
      <section class="scan" aria-label="Inspection">
        <label class="lbl" for="cc-sweep">Sweep the lamp</label>
        <input id="cc-sweep" type="range" min="0" max="100" value="0" step="1" />
        <div class="meter" aria-hidden="true">
          <div class="beam"></div>
          <div class="holdline"></div>
        </div>
        <div class="live" role="status" aria-live="polite">sweep the raking light for the tell</div>
        <button type="button" class="pin" disabled>Stamp the evidence</button>
        <div class="evidence" hidden><span class="stamp">Evidence</span><p>${lot.evidence}</p></div>
      </section>
      <section class="calls" aria-label="Your call — buy, haggle or pass">
        <button type="button" data-call="buy">${CALL_LABEL.buy}</button>
        <button type="button" data-call="haggle">${CALL_LABEL.haggle}</button>
        <button type="button" data-call="pass">${CALL_LABEL.pass}</button>
      </section>
      <section class="receipt" hidden aria-label="Receipt">
        <h3 tabindex="-1">Receipt — lot ${lot.id}</h3>
        <div class="rline"><span>your call</span><b class="r-call"></b></div>
        <div class="rline"><span>settlement</span><b class="r-net"></b></div>
        <p class="r-why"></p>
        <div class="rline"><span>best play</span><b class="r-best"></b></div>
        <p class="r-verdict"></p>
        <div class="r-actions">
          <button type="button" class="share">Challenge a friend</button>
          <a class="next" href="/studio?lot=${next.id}">next lot &rarr; ${next.id}</a>
        </div>
        <p class="share-status" role="status" aria-live="polite"></p>
        <input class="share-url" type="text" readonly hidden aria-label="Lot link" />
      </section>
      <footer class="slip-foot">
        <a class="nextlot" href="/studio?lot=${next.id}">next lot &rarr; ${next.id}</a>
        <a href="/studio">studio</a>
        <span class="fine">a staged exercise — no real seller, item or checkout</span>
      </footer>
    </aside>`;

  const slip = root.querySelector<HTMLElement>(".slip")!;
  const range = root.querySelector<HTMLInputElement>("#cc-sweep")!;
  const beam = root.querySelector<HTMLElement>(".beam")!;
  const holdline = root.querySelector<HTMLElement>(".holdline")!;
  const live = root.querySelector<HTMLElement>(".live")!;
  const pinBtn = root.querySelector<HTMLButtonElement>(".pin")!;
  const evidenceEl = root.querySelector<HTMLElement>(".evidence")!;
  const receipt = root.querySelector<HTMLElement>(".receipt")!;
  const callBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-call]"));

  let held = 0;
  let locked = false;
  let pinned = false;
  let called = false;
  let raf = 0;
  let last = 0;
  let phase = "";

  const setPhase = (text: string) => {
    if (text === phase) return;
    phase = text;
    live.textContent = text;
  };

  const stopScan = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  function onLock() {
    locked = true; // latched: sweeping off the tell later keeps the lock
    pinBtn.disabled = false;
    slip.classList.add("locked");
    setPhase("the tell is lit — hold and stamp it");
    hooks.onLock();
  }

  function tick(now: number) {
    // A hidden tab banks nothing: dt is zeroed and the hold drains.
    const dt = document.hidden ? 0 : Math.min(50, now - last);
    last = now;
    if (document.hidden) held = 0;
    // The lamp is the truth; the slider is only a mirror (and the fallback).
    const f = hooks.readSweep() ?? Number(range.value) / 100;
    if (document.activeElement !== range) range.value = String(Math.round(f * 100));
    const strength = Math.max(0, 1 - Math.abs(f - lot.target) / 0.18);
    if (!locked) {
      held = strength >= 0.65 ? Math.min(450, held + dt) : 0;
      if (held >= 450) onLock();
      else {
        setPhase(strength >= 0.65 ? "on the tell — hold still" : strength >= 0.3 ? "warming" : "sweep the raking light for the tell");
      }
    }
    beam.style.transform = `scaleX(${strength.toFixed(3)})`;
    holdline.style.transform = `scaleX(${(locked ? 1 : held / 450).toFixed(3)})`;
    // Once latched there is nothing left to animate — stop ticking.
    raf = locked ? 0 : requestAnimationFrame(tick);
  }

  range.addEventListener("input", () => {
    const f = Number(range.value) / 100;
    hooks.setSweep(f);
    // No renderer to read back: the slider itself is the position source.
    if (!raf && !locked && !pinned && !called) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  });

  pinBtn.addEventListener("click", () => {
    if (!locked || pinned) return;
    pinned = true;
    stopScan();
    pinBtn.disabled = true;
    pinBtn.textContent = "Evidence stamped";
    evidenceEl.hidden = false;
    slip.classList.add("pinned");
    setPhase("evidence bagged — make the call");
    hooks.onPin();
  });

  function showReceipt(call: Call) {
    const r = settle(lot, call);
    const best = bestPlay(lot);
    receipt.hidden = false;
    receipt.querySelector(".r-call")!.textContent = CALL_LABEL[call].split(" — ")[0];
    const netEl = receipt.querySelector<HTMLElement>(".r-net")!;
    netEl.textContent = `${money(r.net)}${call === "pass" ? "" : " (fictional)"}`;
    netEl.className = `r-net ${r.net > 0 ? "up" : r.net < 0 ? "down" : ""}`;
    receipt.querySelector(".r-why")!.textContent = r.explanation;
    receipt.querySelector(".r-best")!.textContent =
      best.call === "pass" ? "pass — walk away" : `${best.call} — ${money(best.net)}`;
    receipt.querySelector(".r-verdict")!.textContent =
      (call === best.call ? "You made the best play" : "Not the best play") +
      (pinned ? " — with the evidence bagged." : " — called blind, no evidence on the slip.");
    slip.classList.add("called");
    receipt.querySelector<HTMLElement>("h3")!.focus();
  }

  callBtns.forEach((b) =>
    b.addEventListener("click", () => {
      if (called) return;
      called = true;
      stopScan();
      callBtns.forEach((x) => (x.disabled = true));
      b.classList.add("chosen");
      pinBtn.disabled = true;
      hooks.onCall();
      showReceipt(b.dataset.call as Call);
    }),
  );

  const shareBtn = receipt.querySelector<HTMLButtonElement>(".share")!;
  const shareStatus = receipt.querySelector<HTMLElement>(".share-status")!;
  const shareUrl = receipt.querySelector<HTMLInputElement>(".share-url")!;
  shareBtn.addEventListener("click", async () => {
    const url = `${location.origin}/studio?lot=${lot.id}`;
    const text = `Counter check: lot ${lot.id} — the seller's claim is waiting. No spoilers.`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "SnapFlip Counter Check", text, url });
        shareStatus.textContent = "challenge sent";
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      shareStatus.textContent = "lot link copied";
    } catch {
      shareStatus.textContent = "copy the lot link below";
      shareUrl.hidden = false;
      shareUrl.value = url;
      shareUrl.select();
    }
  });

  last = performance.now();
  raf = requestAnimationFrame(tick);
}

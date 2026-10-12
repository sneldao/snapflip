import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { SAMPLE_SPEC, decodeScene, encodeScene, evaluateDecision, parsePreviewBody, validateSpec, type StudioSpec } from "../src/studio/scene.ts";
import { devOnly, type App } from "../src/lib/util.ts";
import { studioPage } from "../src/studio/page.ts";
import { ChapterNav, easeInOutCubic } from "../src/studio/world/nav.ts";
import { clampLampTheta, focusCard, hintFor, lampSide, wrapAngle } from "../src/studio/ux.ts";
import { parseStudioEvent } from "../src/studio/events.ts";
import type { Env } from "../src/types.ts";

const valid = (): StudioSpec => ({ ...SAMPLE_SPEC });
const genericValid = (): StudioSpec => ({ ...valid(), object: "generic", condition: "chipped", rejectChip: true, evidenceLabel: "rim — scenario, unverified" });

describe("validateSpec", () => {
  it("accepts the sample spec and a generic chipped spec", () => {
    assert.deepEqual(validateSpec(valid()), valid());
    assert.deepEqual(validateSpec(genericValid()), genericValid());
  });
  it("rejects non-objects, missing keys, and extra keys", () => {
    for (const bad of [null, 42, "x", [], { ...valid(), extra: 1 }, (() => { const s = valid() as Partial<StudioSpec>; delete s.title; return s; })(), (() => { const s = valid() as Partial<StudioSpec>; delete s.rejectChip; return s; })()]) {
      assert.equal(validateSpec(bad), null, JSON.stringify(bad));
    }
  });
  it("rejects wrong enum values", () => {
    for (const [k, v] of [
      ["object", "vase"],
      ["stage", "dungeon"],
      ["shellColor", "red"],
      ["lightSide", "up"],
      ["condition", "mint"],
    ] as const) {
      assert.equal(validateSpec({ ...valid(), [k]: v }), null, `${k}=${v}`);
    }
  });
  it("rejects non-boolean rule flags", () => {
    assert.equal(validateSpec({ ...valid(), rejectTorn: "yes" }), null);
    assert.equal(validateSpec({ ...valid(), rejectChip: 1 }), null);
  });
  it("rejects non-integer and out-of-range maxCents", () => {
    for (const v of [99, 100001, 45.5, "4500", NaN]) {
      assert.equal(validateSpec({ ...valid(), maxCents: v }), null, `${v}`);
    }
    for (const v of [100, 4500, 100000]) {
      assert.equal(validateSpec({ ...valid(), maxCents: v })?.maxCents, v);
    }
  });
  it("rejects markup and overlong strings", () => {
    assert.equal(validateSpec({ ...valid(), title: "<script>x</script>" }), null);
    assert.equal(validateSpec({ ...valid(), title: "t".repeat(61) }), null);
    assert.equal(validateSpec({ ...valid(), evidenceLabel: "e".repeat(81) }), null);
  });
  it("rejects cross-field combos: cartridge cannot be chipped, generic cannot be torn", () => {
    assert.equal(validateSpec({ ...valid(), condition: "chipped" }), null);
    assert.equal(validateSpec({ ...genericValid(), condition: "torn" }), null);
    assert.ok(validateSpec({ ...valid(), condition: "torn" }));
    assert.ok(validateSpec(genericValid()));
  });
});

describe("parsePreviewBody", () => {
  it("accepts instruction alone and with a valid previous spec", () => {
    const a = parsePreviewBody({ instruction: "make it moody" });
    assert.deepEqual(a, { ok: true, instruction: "make it moody", previous: null });
    const b = parsePreviewBody({ instruction: " dim the light ", previous: valid() });
    assert.deepEqual(b, { ok: true, instruction: "dim the light", previous: valid() });
  });
  it("rejects bad payloads", () => {
    for (const bad of [
      "nope",
      7,
      { instruction: "" },
      { instruction: "   " },
      { instruction: "x".repeat(501) },
      { instruction: 12 },
      { instruction: "ok", previous: { bogus: true } },
      { instruction: "ok", previous: { ...valid(), condition: "mint" } },
    ]) {
      assert.equal(parsePreviewBody(bad).ok, false, JSON.stringify(bad));
    }
  });
});

describe("evaluateDecision", () => {
  it("keeps the collector in for clean/worn even when rejectTorn is on", () => {
    const s = { ...valid(), rejectTorn: true };
    assert.equal(evaluateDecision(s, "clean").eligible, true);
    assert.equal(evaluateDecision(s, "worn").eligible, true);
  });
  it("fires the torn rule only on torn + rejectTorn", () => {
    assert.equal(evaluateDecision({ ...valid(), rejectTorn: true }, "torn").eligible, false);
    assert.equal(evaluateDecision({ ...valid(), rejectTorn: false }, "torn").eligible, true);
  });
  it("fires the chip rule only on chipped + rejectChip", () => {
    const s = genericValid();
    assert.equal(evaluateDecision(s, "chipped").eligible, false);
    assert.match(evaluateDecision(s, "chipped").reason, /reject if chipped/);
    assert.equal(evaluateDecision({ ...s, rejectChip: false }, "chipped").eligible, true);
    assert.equal(evaluateDecision(s, "worn").eligible, true);
  });
  it("does not cross-fire: torn ignores rejectChip, chipped ignores rejectTorn", () => {
    assert.equal(evaluateDecision({ ...valid(), rejectTorn: false, rejectChip: true }, "torn").eligible, true);
    assert.equal(evaluateDecision({ ...valid(), rejectTorn: true, rejectChip: false }, "chipped").eligible, true);
  });
  it("passes the scenario cap through untouched — it never computes or mutates money", () => {
    const d = evaluateDecision({ ...valid(), maxCents: 4500 }, "worn");
    assert.equal(d.limitCents, 4500);
    assert.deepEqual(Object.keys(d).sort(), ["eligible", "limitCents", "reason"]);
  });
});

describe("studioPage AI gate", () => {
  it("dev render enables Direct scene without the disabled notice", () => {
    const page = String(studioPage(true));
    assert.match(page, /id="send"/);
    assert.doesNotMatch(page, /id="send" disabled/);
    assert.doesNotMatch(page, /AI preview is not enabled/);
  });
  it("non-dev render disables Direct scene and shows the honest notice", () => {
    const page = String(studioPage(false));
    assert.match(page, /id="send" disabled/);
    assert.match(page, /AI preview is not enabled on this deployment/);
  });
});

describe("ChapterNav", () => {
  it("last requested chapter wins mid-flight", () => {
    const nav = new ChapterNav(900, false);
    nav.request(1, 0);
    nav.request(2, 300);
    assert.equal(nav.target(), 2);
    assert.ok(nav.alpha(300) < 1);
    assert.equal(nav.done(300), false);
  });
  it("completes a transition after the duration", () => {
    const nav = new ChapterNav(900, false);
    nav.request(2, 0);
    assert.equal(nav.alpha(0), 0);
    assert.equal(nav.alpha(900), 1);
    assert.equal(nav.done(1200), true);
  });
  it("jumps immediately under reduced motion", () => {
    const nav = new ChapterNav(900, true);
    nav.request(1, 0);
    assert.equal(nav.alpha(0), 1);
    assert.equal(nav.done(0), true);
  });
  it("easeInOutCubic endpoints and midpoint", () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(0.5), 0.5);
    assert.equal(easeInOutCubic(1), 1);
  });
});

describe("lamp angle helpers", () => {
  it("leaves angles away from the dead band untouched", () => {
    assert.equal(clampLampTheta(0.35), 0.35);
    assert.equal(clampLampTheta(Math.PI - 0.35), Math.PI - 0.35);
  });
  it("pushes angles inside the dead band out to its edge", () => {
    const dead = -Math.PI / 2;
    assert.ok(Math.abs(clampLampTheta(dead + 0.05) - dead) >= 0.2 - 1e-9);
    assert.ok(Math.abs(clampLampTheta(dead - 0.1) - dead) >= 0.2 - 1e-9);
  });
  it("wraps angles into (-pi, pi]", () => {
    assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  });
  it("maps the lamp to a side by its x direction", () => {
    assert.equal(lampSide(0.35), "right");
    assert.equal(lampSide(Math.PI - 0.35), "left");
  });
});

describe("focusCard", () => {
  const base = { introDone: false, listingDone: true, drawerOpen: false, selectedMarker: -1 };
  it("shows the intro only on an unvisited discover chapter", () => {
    assert.equal(focusCard({ ...base, chapter: "discover" }), "intro");
    assert.equal(focusCard({ ...base, chapter: "discover", drawerOpen: true }), null);
    assert.equal(focusCard({ ...base, chapter: "discover", introDone: true }), null);
  });
  it("shows evidence only with a selected marker in the Atelier", () => {
    assert.equal(focusCard({ ...base, chapter: "inspect" }), null);
    assert.equal(focusCard({ ...base, chapter: "inspect", selectedMarker: 0 }), "evidence");
  });
  it("shows the decision card in the Chamber", () => {
    assert.equal(focusCard({ ...base, chapter: "auction" }), "decision");
  });
});

describe("hintFor", () => {
  const base = { chapter: "inspect", drawerOpen: false, didRotate: false, didLamp: false, didNav: true, splatOn: false, didClick: false } as const;
  it("guides the lamp reveal first, then the item, one step at a time", () => {
    assert.match(hintFor(base) ?? "", /drag the lamp/);
    assert.match(hintFor({ ...base, didLamp: true }) ?? "", /drag the item/);
    assert.equal(hintFor({ ...base, didLamp: true, didRotate: true }), null);
  });
  it("asks for a pin only when a splat is loaded", () => {
    const done = { ...base, didRotate: true, didLamp: true };
    assert.equal(hintFor({ ...done, splatOn: false }), null);
    assert.match(hintFor({ ...done, splatOn: true }) ?? "", /pin evidence/);
  });
  it("hides while the drawer is open", () => {
    assert.equal(hintFor({ ...base, drawerOpen: true }), null);
  });
});

describe("shareable scene links", () => {
  it("round-trips a valid scene and condition", () => {
    const raw = encodeScene({ ...valid(), rejectTorn: true }, "torn");
    assert.deepEqual(decodeScene(raw), { spec: { ...valid(), rejectTorn: true }, condition: "torn" });
  });
  it("rejects missing, malformed, and inconsistent links", () => {
    assert.equal(decodeScene(null), null);
    assert.equal(decodeScene("not json"), null);
    assert.equal(decodeScene(JSON.stringify({ spec: valid(), condition: "mint" })), null);
    assert.equal(decodeScene(JSON.stringify({ spec: valid(), condition: "chipped" })), null);
    assert.equal(decodeScene(JSON.stringify({ spec: { bogus: 1 }, condition: "worn" })), null);
  });
});

describe("parseStudioEvent", () => {
  it("accepts known events and keeps only known chapters", () => {
    assert.deepEqual(parseStudioEvent({ name: "reveal_damage", chapter: "inspect" }), { ok: true, name: "reveal_damage", chapter: "inspect" });
    assert.deepEqual(parseStudioEvent({ name: "link_copied", chapter: "bogus" }), { ok: true, name: "link_copied", chapter: "none" });
  });
  it("rejects unknown or malformed events", () => {
    assert.equal(parseStudioEvent({ name: "anything" }).ok, false);
    assert.equal(parseStudioEvent(null).ok, false);
    assert.equal(parseStudioEvent([]).ok, false);
  });
});

describe("devOnly guard used by /api/studio/preview", () => {
  const guardApp = new Hono<App>();
  guardApp.post("/api/studio/preview", devOnly, (c) => c.json({ ok: true }));
  const call = (env: Partial<Env>) =>
    guardApp.request("/api/studio/preview", { method: "POST" }, env as Env);
  it("404s outside ENVIRONMENT=dev", async () => {
    assert.equal((await call({ ENVIRONMENT: "production" })).status, 404);
    assert.equal((await call({ ENVIRONMENT: "staging" })).status, 404);
  });
  it("passes in dev", async () => {
    assert.equal((await call({ ENVIRONMENT: "dev" })).status, 200);
  });
});

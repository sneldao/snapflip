// Pure UI-state helpers shared by the studio client and the world controller.
// Kept free of DOM and three.js imports so they can be unit-tested under node.

export type StudioChapter = "discover" | "inspect" | "auction";
export type FocusCard = "intro" | "evidence" | "decision" | null;

// Radians per key press in the Atelier.
export const LAMP_STEP = 0.12;
export const ITEM_STEP = 0.2;

// The lamp is kept off the straight-down angle, where the light would sit
// directly under the object and the raking read is lost.
const LAMP_DEAD = -Math.PI / 2;
const LAMP_DEAD_BAND = 0.2;

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function clampLampTheta(theta: number): number {
  const off = wrapAngle(theta - LAMP_DEAD);
  if (Math.abs(off) >= LAMP_DEAD_BAND) return theta;
  return LAMP_DEAD + (off === 0 ? LAMP_DEAD_BAND : Math.sign(off) * LAMP_DEAD_BAND);
}

export function lampSide(theta: number): "left" | "right" {
  return Math.cos(theta) < 0 ? "left" : "right";
}

// At most one focal card is visible at a time.
export function focusCard(s: {
  chapter: StudioChapter;
  introDone: boolean;
  listingDone: boolean;
  drawerOpen: boolean;
  selectedMarker: number;
}): FocusCard {
  if (s.chapter === "discover") return !s.introDone && s.listingDone && !s.drawerOpen ? "intro" : null;
  if (s.chapter === "inspect") return s.selectedMarker >= 0 ? "evidence" : null;
  return "decision";
}

// One instruction at a time, in the order the user needs them.
export function hintFor(s: {
  chapter: StudioChapter;
  drawerOpen: boolean;
  didRotate: boolean;
  didLamp: boolean;
  didNav: boolean;
  splatOn: boolean;
  didClick: boolean;
}): string | null {
  if (s.drawerOpen) return null;
  if (s.chapter === "inspect") {
    if (!s.didRotate) return "drag the item to turn it · or use ↑ ↓";
    if (!s.didLamp) return "drag the lamp to move the light · or use ← →";
    if (s.splatOn && !s.didClick) return "tap the object to pin evidence · tap a plate to match its angle";
    return null;
  }
  if (!s.didNav) return "pick a chapter below · or use [ ] · shift + scroll also works";
  return null;
}

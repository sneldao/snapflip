// Canonical condition-flag vocabulary. Vision grading (A) EMITS these; order
// rules (B) reject/require against them. Both sides import this list so they
// can't drift — a rule that references a flag vision never emits would silently
// disqualify every item. All flags are negative (a problem with the item).
export const CONDITION_FLAGS = [
  "reproduction",
  "water_damage",
  "label_wear",
  "label_torn",
  "sticker",
  "missing_label",
  "corrosion",
] as const;

export type ConditionFlag = (typeof CONDITION_FLAGS)[number];

const FLAG_SET: ReadonlySet<string> = new Set(CONDITION_FLAGS);

/** Keep only recognised flags, de-duplicated. Anything the model invents is dropped. */
export function knownFlags(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((f): f is string => typeof f === "string" && FLAG_SET.has(f)))];
}

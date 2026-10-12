export type StudioObject = "cartridge" | "generic";
export type StudioStage = "archive" | "auction";
export type StudioShellColor = "oxblood" | "charcoal" | "stone";
export type StudioLightSide = "left" | "right";
export type StudioCondition = "clean" | "worn" | "torn" | "chipped";

export interface StudioSpec {
  title: string;
  object: StudioObject;
  stage: StudioStage;
  shellColor: StudioShellColor;
  lightSide: StudioLightSide;
  condition: StudioCondition;
  rejectTorn: boolean;
  rejectChip: boolean;
  maxCents: number;
  evidenceLabel: string;
}

const OBJECTS: StudioObject[] = ["cartridge", "generic"];
const STAGES: StudioStage[] = ["archive", "auction"];
const SHELL_COLORS: StudioShellColor[] = ["oxblood", "charcoal", "stone"];
const LIGHT_SIDES: StudioLightSide[] = ["left", "right"];
const CONDITIONS: StudioCondition[] = ["clean", "worn", "torn", "chipped"];

const SPEC_KEYS = [
  "title",
  "object",
  "stage",
  "shellColor",
  "lightSide",
  "condition",
  "rejectTorn",
  "rejectChip",
  "maxCents",
  "evidenceLabel",
] as const;

const hasMarkup = (s: string) => /<[a-zA-Z/!]/.test(s);

export function validateSpec(input: unknown): StudioSpec | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(SPEC_KEYS as readonly string[]).includes(k)) return null;
  if (typeof o.title !== "string" || o.title.length === 0 || o.title.length > 60 || hasMarkup(o.title)) return null;
  if (!OBJECTS.includes(o.object as StudioObject)) return null;
  if (!STAGES.includes(o.stage as StudioStage)) return null;
  if (!SHELL_COLORS.includes(o.shellColor as StudioShellColor)) return null;
  if (!LIGHT_SIDES.includes(o.lightSide as StudioLightSide)) return null;
  if (!CONDITIONS.includes(o.condition as StudioCondition)) return null;
  if (typeof o.rejectTorn !== "boolean" || typeof o.rejectChip !== "boolean") return null;
  if (typeof o.maxCents !== "number" || !Number.isInteger(o.maxCents) || o.maxCents < 100 || o.maxCents > 100000) return null;
  if (typeof o.evidenceLabel !== "string" || o.evidenceLabel.length === 0 || o.evidenceLabel.length > 80 || hasMarkup(o.evidenceLabel)) return null;
  if (o.object === "cartridge" && o.condition === "chipped") return null;
  if (o.object === "generic" && o.condition === "torn") return null;
  return {
    title: o.title,
    object: o.object as StudioObject,
    stage: o.stage as StudioStage,
    shellColor: o.shellColor as StudioShellColor,
    lightSide: o.lightSide as StudioLightSide,
    condition: o.condition as StudioCondition,
    rejectTorn: o.rejectTorn,
    rejectChip: o.rejectChip,
    maxCents: o.maxCents,
    evidenceLabel: o.evidenceLabel,
  };
}

export type PreviewBody =
  | { ok: true; instruction: string; previous: StudioSpec | null }
  | { ok: false; error: string };

export function parsePreviewBody(body: unknown): PreviewBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid payload" };
  const { instruction, previous } = body as { instruction?: unknown; previous?: unknown };
  if (typeof instruction !== "string" || instruction.trim().length === 0 || instruction.length > 500) {
    return { ok: false, error: "instruction must be a non-empty string up to 500 chars" };
  }
  let prev: StudioSpec | null = null;
  if (previous !== undefined && previous !== null) {
    prev = validateSpec(previous);
    if (!prev) return { ok: false, error: "previous spec failed validation" };
  }
  return { ok: true, instruction: instruction.trim(), previous: prev };
}

export const SAMPLE_SPEC: StudioSpec = {
  title: "Worn cartridge inspection — sample",
  object: "cartridge",
  stage: "auction",
  shellColor: "stone",
  lightSide: "right",
  condition: "worn",
  rejectTorn: false,
  rejectChip: false,
  maxCents: 4500,
  evidenceLabel: "Label edge — scenario, unverified",
};

export interface AgentDecision {
  eligible: boolean;
  limitCents: number;
  reason: string;
}

export function evaluateDecision(spec: StudioSpec, condition: StudioCondition): AgentDecision {
  const fired =
    condition === "torn" && spec.rejectTorn
      ? "reject if label is torn"
      : condition === "chipped" && spec.rejectChip
        ? "reject if chipped"
        : null;
  const eligible = !fired;
  const limitCents = spec.maxCents;
  const reason = fired
    ? `Rule "${fired}" fires: collector walks away under the ${condition} scenario.`
    : `Collector stays in up to $${(limitCents / 100).toFixed(2)} while the ${condition} scenario holds.`;
  return { eligible, limitCents, reason };
}

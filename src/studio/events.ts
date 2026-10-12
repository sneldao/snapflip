// Anonymous engagement events for the studio. No scene content, no identifiers:
// only the event name and the chapter the visitor was in.

export const STUDIO_EVENTS = ["reveal_damage", "evidence_open", "link_copied", "chamber_reached"] as const;
export type StudioEventName = (typeof STUDIO_EVENTS)[number];

const CHAPTER_NAMES = ["discover", "inspect", "auction"] as const;

export type ParsedStudioEvent = { ok: true; name: StudioEventName; chapter: string } | { ok: false; error: string };

export function parseStudioEvent(body: unknown): ParsedStudioEvent {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid payload" };
  const { name, chapter } = body as { name?: unknown; chapter?: unknown };
  if (typeof name !== "string" || !(STUDIO_EVENTS as readonly string[]).includes(name)) {
    return { ok: false, error: "unknown event" };
  }
  const ch = typeof chapter === "string" && (CHAPTER_NAMES as readonly string[]).includes(chapter) ? chapter : "none";
  return { ok: true, name: name as StudioEventName, chapter: ch };
}

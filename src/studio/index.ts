import { Hono } from "hono";
import { claudeJson, llmAvailable } from "../lib/claude";
import { devOnly, isDev, type App } from "../lib/util";
import { studioPage } from "./page";
import { parsePreviewBody, validateSpec } from "./scene";
import { parseStudioEvent } from "./events";

const STUDIO_SYSTEM = `You configure a fictional 3D inspection scene for SnapFlip Studio. Translate the user's instruction into a bounded scene and simulation rule data, not facts about a real object. Return a single JSON object with exactly these keys: "title" (short string), "object" ("cartridge" or "generic"), "stage" ("archive" or "auction"), "shellColor" ("oxblood" or "charcoal" or "stone"), "lightSide" ("left" or "right"), "condition" ("clean" or "worn" or "torn" or "chipped"), "rejectTorn" (boolean), "rejectChip" (boolean), "maxCents" (integer 100 through 100000), "evidenceLabel" (short string). If a previous scene JSON is provided, keep unspecified fields and change only values requested by the latest instruction. Unsupported objects use generic. For a chip use condition "chipped" and rejectChip. The condition is a described scenario, never an observed fact; never assert authenticity. Do not return code, markup, or other keys.`;

export const studio = new Hono<App>();

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PHOTO_MAX = 8 * 1024 * 1024;
const PHOTO_KEY = /^studio-[0-9a-f-]{36}\.(jpg|png|webp)$/;

function sniffImage(buf: Uint8Array, ext: string): boolean {
  if (ext === "jpg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === "png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
}

studio.post("/api/studio/photos", devOnly, async (c) => {
  const type = (c.req.header("content-type") ?? "").split(";")[0].trim();
  const ext = PHOTO_EXT[type];
  if (!ext) return c.json({ error: "expected image/jpeg, image/png or image/webp" }, 415);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > PHOTO_MAX) {
    return c.json({ error: "photo must be between 1 byte and 8MB" }, 413);
  }
  if (!sniffImage(buf, ext)) return c.json({ error: "content does not match the declared image type" }, 400);
  const key = `studio-${crypto.randomUUID()}.${ext}`;
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key, url: `/studio-photos/${key}` });
});

studio.get("/studio-photos/:key", devOnly, async (c) => {
  const key = c.req.param("key");
  if (!PHOTO_KEY.test(key)) return c.notFound();
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

studio.post("/api/studio/preview", devOnly, async (c) => {
  const type = c.req.header("content-type") ?? "";
  if (!type.includes("application/json")) return c.json({ error: "expected application/json" }, 415);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const parsed = parsePreviewBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (!llmAvailable(c.env)) return c.json({ error: "model unavailable: no provider configured" }, 503);
  let out: unknown;
  try {
    out = await claudeJson<unknown>(c.env, {
      system: STUDIO_SYSTEM,
      content: [
        { type: "text", text: `Previous scene JSON: ${JSON.stringify(parsed.previous)}\nInstruction: ${parsed.instruction}` },
      ],
      maxTokens: 512,
    });
  } catch (e) {
    console.error("studio preview model call failed:", (e as Error).message);
    return c.json({ error: "model call failed" }, 502);
  }
  const spec = validateSpec(out);
  if (!spec) return c.json({ error: "model returned an invalid scene spec" }, 502);
  return c.json({ spec });
});

// Public on purpose: production engagement is the point. Writes are anonymous
// and validated; a missing dataset binding drops the event silently.
studio.post("/api/studio/event", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const parsed = parseStudioEvent(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  c.env.STUDIO_EVENTS?.writeDataPoint({ blobs: [parsed.name, parsed.chapter], doubles: [1], indexes: [parsed.name] });
  return c.json({ ok: true }, 202);
});

studio.get("/studio", (c) => c.html(studioPage(isDev(c.env))));

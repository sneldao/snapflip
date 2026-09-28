// Owner: A. Claude vision: identify the exact SKU and grade condition from a photo.
import { claudeJson, llmAvailable } from "./lib/claude";
import { CONDITION_FLAGS } from "./lib/flags";
import type { Env, GradeReport, Identification, Sku } from "./types";

type MediaType = "image/jpeg" | "image/png" | "image/webp";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function image(photo: ArrayBuffer, mediaType: MediaType) {
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType, data: toBase64(photo) },
  };
}

/** Categories we recognise. Only retro games trade today; the rest are on the roadmap ("next on the rack"). */
export const CATEGORIES = ["retro-game", "vinyl", "lego", "trading-card", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/** `remark`: one friendly collector-style line about the item, shown to the seller for rapport. */
export type Identified = Identification & { remark?: string; category: Category };

export async function identify(env: Env, photo: ArrayBuffer, mediaType: MediaType = "image/jpeg"): Promise<Identified> {
  const { results } = await env.DB.prepare("SELECT id, title, platform, region FROM skus").all<Pick<Sku, "id" | "title" | "platform" | "region">>();

  if (!llmAvailable(env)) {
    // Stub so the flow works without a key. Remove once the prompt is tuned.
    return { skuId: "gb-pokemon-yellow-us", title: "Pokemon Yellow Version", confidence: 0.99, alternatives: [], remark: "The Pikachu-follows-you edition — a Game Boy classic.", category: "retro-game" };
  }

  // TODO(A): tune on real cartridge photos until 5/5 correct.
  const out = await claudeJson<Identified>(env, {
    system: `You identify items photographed at thrift stores for a retro video game marketplace.
"category": "retro-game" for any video game (cartridge, disc or boxed); "vinyl" for records; "lego" for LEGO sets or bricks; "trading-card" for Pokémon/Magic/sports cards etc.; "other" for anything else.
For non-games, skuId is null and title is a short plain description of the item (e.g. "Levi's denim jacket").
Pick the matching SKU from this catalog (id | title | platform | region):
${results.map((s) => `${s.id} | ${s.title} | ${s.platform ?? ""} | ${s.region ?? ""}`).join("\n")}
If none match, use skuId null and put the item's full name, platform and region (if visible) in title — confidence is how sure you are of that name.
"remark": one short, warm sentence a knowledgeable collector friend would say about this exact item — something widely known about the game, or something visible on this copy (label, shell, wear). Never mention prices, value, rarity or investment. If unsure of a fact, comment on what you can see instead. Max 120 characters.
Shape: {"category": string, "skuId": string|null, "title": string, "confidence": number 0..1, "alternatives": [{"skuId","title","confidence"}] (up to 3), "remark": string}`,
    content: [image(photo, mediaType), { type: "text", text: "Identify this item." }],
  });
  // Never trust an id that isn't in the catalog.
  const known = new Set(results.map((s) => s.id));
  if (out.skuId && !known.has(out.skuId)) out.skuId = null;
  out.alternatives = (out.alternatives ?? []).filter((a) => known.has(a.skuId));
  out.remark = typeof out.remark === "string" ? out.remark.trim().slice(0, 160) : undefined;
  // A catalog match is a game by definition; otherwise only accept a category we know.
  out.category = out.skuId ? "retro-game" : (CATEGORIES as readonly string[]).includes(out.category) ? out.category : "retro-game";
  return out;
}

export async function grade(env: Env, photo: ArrayBuffer, title: string, mediaType: MediaType = "image/jpeg"): Promise<GradeReport> {
  if (!llmAvailable(env)) {
    return { grade: "B", notes: "Stub grade: light label wear.", flags: ["label_wear"] };
  }

  // TODO(A): calibrate grades against a few known carts.
  return claudeJson<GradeReport>(env, {
    system: `You grade the condition of a "${title}" cartridge from a photo.
Grades: A = near mint, B = light wear, C = heavy wear/label damage, D = damaged or incomplete.
Flags (only if visible): ${CONDITION_FLAGS.join(", ")}.
Shape: {"grade": "A"|"B"|"C"|"D", "notes": string (one sentence), "flags": string[]}`,
    content: [image(photo, mediaType), { type: "text", text: "Grade this item." }],
  });
}

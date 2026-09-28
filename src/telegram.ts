// Owner: A. Telegram bot (seller intake + all user-facing notifications).
import { Hono } from "hono";
import { startAuction } from "./auction";
import { findCandidates } from "./match";
import { capture, release } from "./payments";
import { grade, identify } from "./vision";
import { newId, safeEqual, usd, type App } from "./lib/util";
import type { Env, Identification, NotifyEvent, NotifyTarget, Snap } from "./types";

// Below this identification confidence, ask the seller to pick from Claude's top matches
// instead of guessing — a wrong SKU would start an auction against the wrong buyers.
const CONFIDENCE_THRESHOLD = 0.75;

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: { file_id: string; width: number; height: number }[];
}
interface TgUpdate {
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: TgMessage };
}
type Buttons = { text: string; callback_data?: string; url?: string }[][];

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  // No token (local dev): no-op instead of hitting the real API, so callbacks don't crash.
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log(`[tg stub] ${method}`);
    return {} as T;
  }
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
  return json.result;
}

export async function send(env: Env, chatId: string | number, text: string, buttons?: Buttons): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log(`[tg stub → ${chatId}] ${text}`);
    return;
  }
  await tg(env, "sendMessage", { chat_id: chatId, text, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
}

/** HANDOFF B, C → A. Every user-facing message goes through here. */
export async function notify(env: Env, to: NotifyTarget, event: NotifyEvent): Promise<void> {
  const row = to.buyerId
    ? await env.DB.prepare("SELECT tg_chat_id FROM buyers WHERE id = ?").bind(to.buyerId).first<{ tg_chat_id: string | null }>()
    : await env.DB.prepare("SELECT tg_chat_id FROM sellers WHERE id = ?").bind(to.sellerId ?? "").first<{ tg_chat_id: string | null }>();
  const chatId = row?.tg_chat_id;
  const link = (id: string) => `${env.PUBLIC_URL}/a/${id}`;

  let text: string;
  let buttons: Buttons | undefined;
  switch (event.type) {
    case "agent_dropped":
      // TODO(A): "Raise max" flow → buyerAgent(env, buyerId).raise(...)
      text = `Your agent dropped out of ${event.title} at ${usd(event.atCents)} (${event.reason}). ${link(event.auctionId)}`;
      break;
    case "auction_won":
      text = `Your agent won ${event.title} for ${usd(event.priceCents)}. Card authorized; you're charged when the seller confirms.`;
      break;
    case "presold":
      text = `PRE-SOLD: ${event.title} cleared at ${usd(event.priceCents)}. You net ${usd(event.netCents)}. Buy it, then tap below.`;
      buttons = [[{ text: "I bought it", callback_data: `confirm:${event.auctionId}` }]];
      break;
    case "no_sale":
      text = `No sale on ${event.title}: nothing cleared your reserve. Leave it on the rack.`;
      break;
    case "captured":
      text = `Seller has your ${event.title}. Charged ${usd(event.priceCents)}.`;
      break;
    case "shipped":
      text = `${event.title} shipped. Tracking: ${event.tracking}`;
      break;
    case "released":
      text = `Payout of ${usd(event.amountCents)} sent for auction ${event.auctionId}.`;
      break;
  }
  if (!chatId) {
    console.log(`[notify: no chat for ${JSON.stringify(to)}] ${text}`);
    return;
  }
  await send(env, chatId, text, buttons);
}

async function upsertSeller(env: Env, chatId: number): Promise<string> {
  await env.DB.prepare("INSERT INTO sellers (id, tg_chat_id) VALUES (?, ?) ON CONFLICT(tg_chat_id) DO NOTHING")
    .bind(newId("s"), String(chatId))
    .run();
  const row = await env.DB.prepare("SELECT id FROM sellers WHERE tg_chat_id = ?").bind(String(chatId)).first<{ id: string }>();
  return row!.id;
}

/** Claude's best SKU guess plus its alternatives, de-duplicated, for the picker buttons. */
function identifyOptions(id: Identification): { skuId: string; title: string }[] {
  const out: { skuId: string; title: string }[] = [];
  const seen = new Set<string>();
  const push = (skuId: string | null, title: string) => {
    if (skuId && !seen.has(skuId)) {
      seen.add(skuId);
      out.push({ skuId, title });
    }
  };
  push(id.skuId, id.title);
  for (const a of id.alternatives ?? []) push(a.skuId, a.title);
  return out;
}

async function handlePhoto(env: Env, msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id;
  const sellerId = await upsertSeller(env, chatId);
  const largest = msg.photo!.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
  await send(env, chatId, "Got it. Identifying and grading...");

  const file = await tg<{ file_path: string }>(env, "getFile", { file_id: largest.file_id });
  const photo = await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`)).arrayBuffer();
  const snapId = newId("sn");
  const r2Key = `snaps/${snapId}.jpg`;
  await env.PHOTOS.put(r2Key, photo, { httpMetadata: { contentType: "image/jpeg" } });

  const id = await identify(env, photo);
  // Persist the snap up front (SKU still unknown) so a picker callback can resolve it later.
  await env.DB.prepare("INSERT INTO snaps (id, seller_id, r2_key, confidence) VALUES (?, ?, ?, ?)")
    .bind(snapId, sellerId, r2Key, id.confidence)
    .run();

  // Confident: grade and go straight to the reserve prompt.
  if (id.skuId && id.confidence >= CONFIDENCE_THRESHOLD) {
    return finalizeIdentification(env, chatId, snapId, id.skuId, id.title);
  }

  // Low confidence: let the seller pick from the top matches instead of guessing wrong.
  const options = identifyOptions(id).slice(0, 3);
  if (options.length) {
    await send(
      env,
      chatId,
      `Not sure which one this is${id.title ? ` — closest guess is ${id.title}` : ""}. Tap the match:`,
      options.map((o) => [{ text: o.title, callback_data: `pick:${snapId}:${o.skuId}` }]),
    );
    return;
  }
  await send(env, chatId, "Couldn't match this to a catalog item. Try another angle with the label in view.");
}

/** Grade the (now-known) item, save it against the snap, and prompt the seller for a reserve. */
async function finalizeIdentification(env: Env, chatId: number, snapId: string, skuId: string, title: string): Promise<void> {
  const row = await env.DB.prepare("SELECT seller_id, r2_key FROM snaps WHERE id = ?").bind(snapId).first<{ seller_id: string; r2_key: string }>();
  if (!row) {
    await send(env, chatId, "That photo expired — snap it again.");
    return;
  }
  const obj = await env.PHOTOS.get(row.r2_key);
  if (!obj) {
    await send(env, chatId, "Lost the photo — snap it again.");
    return;
  }
  const g = await grade(env, await obj.arrayBuffer(), title);
  await env.DB.prepare("UPDATE snaps SET sku_id = ?, grade = ?, grade_notes = ?, flags_json = ? WHERE id = ?")
    .bind(skuId, g.grade, g.notes, JSON.stringify(g.flags), snapId)
    .run();

  const snap: Snap = {
    id: snapId, sellerId: row.seller_id, r2Key: row.r2_key, skuId, title, confidence: 1,
    grade: g.grade, gradeNotes: g.notes, flags: g.flags, rackCents: null, reserveCents: null,
  };
  const eligible = (await findCandidates(env, snap)).filter((v) => v.eligible).length;
  // Don't reveal bid amounts: they're private to each buyer agent.
  await send(
    env,
    chatId,
    `${title}, grade ${g.grade}: ${g.notes}\n` +
      `${eligible} buyer agent${eligible === 1 ? "" : "s"} ready to bid.\n` +
      (eligible ? "Reply with your minimum price in dollars (e.g. 10) to start a 60s auction." : "No matching demand right now."),
  );
}

async function handleReserve(env: Env, msg: TgMessage, dollars: number): Promise<void> {
  const seller = await env.DB.prepare("SELECT id FROM sellers WHERE tg_chat_id = ?").bind(String(msg.chat.id)).first<{ id: string }>();
  const row = seller
    ? await env.DB.prepare(
        `SELECT sn.*, COALESCE(sk.title, '') AS title FROM snaps sn LEFT JOIN skus sk ON sk.id = sn.sku_id
          WHERE sn.seller_id = ? AND sn.reserve_cents IS NULL AND sn.sku_id IS NOT NULL ORDER BY sn.created_at DESC LIMIT 1`,
      ).bind(seller.id).first<Record<string, unknown>>()
    : null;
  if (!row) {
    await send(env, msg.chat.id, "Send a photo first.");
    return;
  }
  const reserveCents = Math.round(dollars * 100);
  await env.DB.prepare("UPDATE snaps SET reserve_cents = ? WHERE id = ?").bind(reserveCents, row.id).run();
  const snap: Snap = {
    id: row.id as string, sellerId: row.seller_id as string, r2Key: row.r2_key as string, skuId: row.sku_id as string,
    title: row.title as string, confidence: row.confidence as number, grade: row.grade as Snap["grade"],
    gradeNotes: row.grade_notes as string, flags: JSON.parse(row.flags_json as string), rackCents: null, reserveCents,
  };
  const { auctionId, view } = await startAuction(env, snap, reserveCents);
  await send(env, msg.chat.id, `Auction live with ${view.active.length} agents. Watch it climb:`, [
    [{ text: "Open live auction", url: `${env.PUBLIC_URL}/a/${auctionId}` }],
  ]);
}

async function handleUpdate(env: Env, u: TgUpdate): Promise<void> {
  if (u.callback_query) {
    const parts = (u.callback_query.data ?? "").split(":");
    const action = parts[0];
    await tg(env, "answerCallbackQuery", { callback_query_id: u.callback_query.id });
    const chatId = u.callback_query.message?.chat.id;
    try {
      if (action === "confirm") {
        await capture(env, parts[1]);
        if (chatId) await send(env, chatId, "Payment captured. Ship it, then tap below.", [[{ text: "Delivered (demo)", callback_data: `delivered:${parts[1]}` }]]);
      } else if (action === "delivered") {
        await release(env, parts[1]);
      } else if (action === "pick") {
        // Seller chose a SKU from the low-confidence picker: pick:<snapId>:<skuId>
        const [, snapId, skuId] = parts;
        const sku = await env.DB.prepare("SELECT title FROM skus WHERE id = ?").bind(skuId).first<{ title: string }>();
        if (chatId && sku) await finalizeIdentification(env, chatId, snapId, skuId, sku.title);
      }
    } catch (e) {
      if (chatId) await send(env, chatId, `Couldn't do that: ${(e as Error).message}`);
    }
    return;
  }

  const msg = u.message;
  if (!msg) return;
  if (msg.photo?.length) return handlePhoto(env, msg);

  const text = msg.text?.trim() ?? "";
  // Buyer linking: t.me/<bot>?start=<buyerId>
  const start = text.match(/^\/start\s+(b_[a-z0-9]+)$/i);
  if (start) {
    const r = await env.DB.prepare("UPDATE buyers SET tg_chat_id = ? WHERE id = ?").bind(String(msg.chat.id), start[1]).run();
    await send(env, msg.chat.id, r.meta.changes ? "Linked. Your agent will message you here when it bids and wins." : "Unknown buyer link.");
    return;
  }
  const price = text.match(/^\$?(\d{1,4}(?:\.\d{1,2})?)$/);
  if (price) return handleReserve(env, msg, Number(price[1]));
  await send(env, msg.chat.id, "Snap a photo of an item to see who wants it.");
}

export const telegram = new Hono<App>();

telegram.post("/telegram/webhook", async (c) => {
  if (!safeEqual(c.req.header("x-telegram-bot-api-secret-token"), c.env.TELEGRAM_WEBHOOK_SECRET)) {
    return c.text("forbidden", 403);
  }
  const update = await c.req.json<TgUpdate>();
  // Ack fast; Telegram retries slow webhooks.
  c.executionCtx.waitUntil(handleUpdate(c.env, update).catch((e) => console.error("telegram update failed", e)));
  return c.text("ok");
});

// Owner: A. Telegram bot (seller intake + all user-facing notifications).
import { Hono } from "hono";
import { startAuction } from "./auction";
import { buyerAgent } from "./buyer";
import { findCandidates } from "./match";
import { capture, expressEligible, release, releaseExpress } from "./payments";
import { expressFeeBps, sellerFeeBps, splitExpress, splitFee } from "./lib/fees";
import { grade, identify } from "./vision";
import { newId, safeEqual, usd, type App } from "./lib/util";
import { nearbyDemand, offerWatch, ordinal, snapsToday } from "./watches";
import type { Env, Identification, NotifyEvent, NotifyTarget, Snap } from "./types";

// Below this identification confidence, ask the seller to pick from Claude's top matches
// instead of guessing — a wrong SKU would start an auction against the wrong buyers.
const CONFIDENCE_THRESHOLD = 0.75;

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: { file_id: string; width: number; height: number }[];
  document?: { file_id: string; mime_type?: string };
  sticker?: { file_id: string };
  reply_markup?: { inline_keyboard: Buttons };
}
type ImageType = "image/jpeg" | "image/png" | "image/webp";
const VISION_TYPES: string[] = ["image/jpeg", "image/png", "image/webp"];
interface TgUpdate {
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: TgMessage };
}
type Buttons = { text: string; callback_data?: string; url?: string }[][];

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

export async function send(env: Env, chatId: string | number, text: string, buttons?: Buttons): Promise<number | undefined> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log(`[tg stub → ${chatId}] ${text}`);
    return;
  }
  const msg = await tg<{ message_id: number }>(env, "sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  return msg.message_id;
}

/** Edit a message in place. Falls back to a fresh send when there's no id or the edit fails.
 *  Omitting buttons clears the inline keyboard — that's the intent. */
export async function edit(env: Env, chatId: string | number, messageId: number | undefined, text: string, buttons?: Buttons): Promise<number | undefined> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log(`[tg stub → ${chatId}] ${text}`);
    return messageId;
  }
  if (messageId === undefined) return send(env, chatId, text, buttons);
  try {
    await tg(env, "editMessageText", {
      chat_id: chatId, message_id: messageId, text, parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
    return messageId;
  } catch {
    return send(env, chatId, text, buttons);
  }
}

export async function typing(env: Env, chatId: string | number): Promise<void> {
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
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
    case "agent_dropped": {
      // One-tap override: offer to lift the order max 25% past the dropout point and rejoin.
      const raiseToCents = Math.ceil((event.atCents * 1.25) / 100) * 100;
      text = `<code>DROPPED @ ${usd(event.atCents)}</code> · ${esc(event.title)}\n${esc(event.reason)}`;
      buttons = [
        [{ text: `Raise max to ${usd(raiseToCents)} and rejoin`, callback_data: `raise:${event.auctionId}:${event.orderId}:${raiseToCents}` }],
        [{ text: "Watch live", url: link(event.auctionId) }],
      ];
      break;
    }
    case "auction_won":
      text = `<code>WON ${usd(event.priceCents)}</code> · ${esc(event.title)}\n${usd(event.maxCents - event.priceCents)} under your ${usd(event.maxCents)} max — clearing, not max. Card authorized, charged once the seller has it in hand.`;
      buttons = [[{ text: "Watch live", url: link(event.auctionId) }]];
      break;
    case "presold":
      text = `<code>SOLD ${usd(event.priceCents)}</code> · ${esc(event.title)}\nCleared at ${usd(event.priceCents)} (incl. ${usd(event.priceCents - event.netCents)} SnapFlip fee) — you net <b>${usd(event.netCents)}</b>.\n▸ Grab it off the rack, then tap below.`;
      buttons = [[{ text: "I bought it", callback_data: `confirm:${event.auctionId}` }]];
      break;
    case "no_sale":
      text = `<code>NO SALE</code> · ${esc(event.title)}\nNothing cleared your floor. Leave it on the rack — no harm done.`;
      break;
    case "settlement_failed":
      text = `<code>NO SALE</code> · ${esc(event.title)}\nIt cleared your floor, but no payment went through (${esc(event.reason)}). Nobody was charged.\n▸ Snap it again to re-list.`;
      break;
    case "captured":
      text = `<code>CAPTURED ${usd(event.priceCents)}</code> · ${esc(event.title)}\nThe seller has it. Your card was charged.`;
      break;
    case "shipped":
      text = `<code>SHIPPED</code> · ${esc(event.title)}\nTracking <code>${esc(event.tracking)}</code>`;
      break;
    case "released":
      text = `<code>PAID OUT ${usd(event.amountCents)}</code>\nTransferred to your Stripe account.`;
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

/** The two no-buyer outcomes share one tail: at most one honest line from our own data,
 *  plus a "ping me" button that arms a watch (active=0 until tapped). */
async function noBuyerExtras(env: Env, sellerId: string, snapId: string, skuId: string | null, title: string): Promise<{ line: string; buttons: Buttons }> {
  let line = "";
  const near = await nearbyDemand(env, title, skuId ?? undefined);
  if (near) {
    line = `\nBut <b>${near.collectors} collector${near.collectors === 1 ? "" : "s"}</b> ${near.collectors === 1 ? "is" : "are"} hunting ${near.titles.map(esc).join(" and ")}.`;
  } else {
    const n = await snapsToday(env, sellerId);
    if (n >= 2) line = `\n${ordinal(n)} snap today — keep them coming.`;
  }
  const watchId = await offerWatch(env, { sellerId, snapId, skuId, title });
  return {
    line,
    buttons: [
      [{ text: "Ping me if someone hunts it", callback_data: `watch:${watchId}` }],
      [{ text: "What's in demand", url: `${env.PUBLIC_URL}/` }],
    ],
  };
}

/** Photos arrive as compressed `photo` (always JPEG) or, when sent as a file, as an image `document`. */
async function handlePhoto(env: Env, chatId: number, fileId: string, mediaType: ImageType): Promise<void> {
  const statusId = await send(env, chatId, "&gt; reading label…");
  try {
    await readSnap(env, chatId, fileId, mediaType, statusId);
  } catch (e) {
    await edit(env, chatId, statusId, "Couldn't read that snap — something hiccuped on my end.\n▸ Send the photo again.");
    throw e;
  }
}

async function readSnap(env: Env, chatId: number, fileId: string, mediaType: ImageType, statusId: number | undefined): Promise<void> {
  const sellerId = await upsertSeller(env, chatId);
  const file = await tg<{ file_path: string }>(env, "getFile", { file_id: fileId });
  const photo = await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`)).arrayBuffer();
  const snapId = newId("sn");
  const r2Key = `snaps/${snapId}.${mediaType.split("/")[1].replace("jpeg", "jpg")}`;
  await env.PHOTOS.put(r2Key, photo, { httpMetadata: { contentType: mediaType } });

  await typing(env, chatId);
  const id = await identify(env, photo, mediaType);
  // Persist the snap up front (SKU still unknown) so a picker callback can resolve it later.
  await env.DB.prepare("INSERT INTO snaps (id, seller_id, r2_key, confidence) VALUES (?, ?, ?, ?)")
    .bind(snapId, sellerId, r2Key, id.confidence)
    .run();

  // Confident: grade and go straight to the reserve prompt.
  // The model's collector remark opens every outcome: acknowledge what they found before anything else.
  const remark = id.remark ? `\n<i>${esc(id.remark)}</i>` : "";
  if (id.skuId && id.confidence >= CONFIDENCE_THRESHOLD) {
    return finalizeIdentification(env, chatId, snapId, id.skuId, id.title, statusId, id.remark);
  }

  // Low confidence: let the seller pick from the top matches instead of guessing wrong.
  const options = identifyOptions(id).slice(0, 3);
  if (options.length) {
    await edit(
      env,
      chatId,
      statusId,
      `${id.title ? `Looks like <b>${esc(id.title)}</b>…${remark}\n\nBut I want to be sure before agents bid.` : "Not sure which one this is."} Tap the match:`,
      options.map((o) => [{ text: o.title, callback_data: `pick:${snapId}:${o.skuId}` }]),
    );
    return;
  }
  // A confident read of an item we don't list is a catalog gap, not a bad photo — say what we saw.
  const demand: Buttons = [[{ text: "What's in demand", url: `${env.PUBLIC_URL}/` }]];
  if (id.title && id.confidence >= CONFIDENCE_THRESHOLD) {
    const extras = await noBuyerExtras(env, sellerId, snapId, id.skuId ?? null, id.title);
    await edit(
      env,
      chatId,
      statusId,
      `Nice find — <b>${esc(id.title)}</b>.${remark}\n\nNo agents are hunting this one yet.${extras.line}\n▸ Snap the next cart, or tap below and I'll ping you if a collector starts looking.`,
      extras.buttons,
    );
    return;
  }
  await edit(
    env,
    chatId,
    statusId,
    `${id.title ? `I think that's <b>${esc(id.title)}</b>, but the label's hard to read.` : "I can't quite make out the label."}${remark}\n▸ One more try? Label flat, well lit, filling the frame.`,
    demand,
  );
}

/** Grade the (now-known) item, save it against the snap, and prompt the seller for a reserve.
 *  Edits the status message in place so the photo flow is one message. */
async function finalizeIdentification(env: Env, chatId: number, snapId: string, skuId: string, title: string, statusMsgId?: number, remark?: string): Promise<void> {
  const aside = remark ? `\n<i>${esc(remark)}</i>` : "";
  const row = await env.DB.prepare("SELECT seller_id, r2_key FROM snaps WHERE id = ?").bind(snapId).first<{ seller_id: string; r2_key: string }>();
  if (!row) {
    await edit(env, chatId, statusMsgId, "That photo expired — snap it again.");
    return;
  }
  const obj = await env.PHOTOS.get(row.r2_key);
  if (!obj) {
    await edit(env, chatId, statusMsgId, "Lost the photo — snap it again.");
    return;
  }
  await edit(env, chatId, statusMsgId, `<b>${esc(title)}</b>${aside}\n\n&gt; grading condition…`);
  await typing(env, chatId);
  const ct = obj.httpMetadata?.contentType ?? "image/jpeg";
  const g = await grade(env, await obj.arrayBuffer(), title, (VISION_TYPES.includes(ct) ? ct : "image/jpeg") as ImageType);
  await env.DB.prepare("UPDATE snaps SET sku_id = ?, grade = ?, grade_notes = ?, flags_json = ? WHERE id = ?")
    .bind(skuId, g.grade, g.notes, JSON.stringify(g.flags), snapId)
    .run();

  const snap: Snap = {
    id: snapId, sellerId: row.seller_id, r2Key: row.r2_key, skuId, title, confidence: 1,
    grade: g.grade, gradeNotes: g.notes, flags: g.flags, rackCents: null, reserveCents: null,
  };
  const eligible = (await findCandidates(env, snap)).filter((v) => v.eligible).length;
  // Don't reveal bid amounts: they're private to each buyer agent.
  let buttons: Buttons | undefined;
  let tail: string;
  if (eligible) {
    tail = `<b>${eligible} buyer agent${eligible === 1 ? "" : "s"}</b> ready to bid.\n▸ Reply with a floor price (e.g. <code>10</code>) to open a 60s auction.`;
  } else {
    const extras = await noBuyerExtras(env, row.seller_id, snapId, skuId, title);
    tail = `No standing orders for this one yet.${extras.line}\n▸ Snap the next cart, or tap below and I'll ping you if a collector starts looking.`;
    buttons = extras.buttons;
  }
  await edit(env, chatId, statusMsgId, `<b>${esc(title)}</b> · grade ${g.grade}${aside}\n${esc(g.notes)}\n\n${tail}`, buttons);
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
    await send(env, msg.chat.id, "No item waiting for a price.\n▸ Send a photo first.");
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
  await send(env, msg.chat.id, `<code>LIVE</code> 60s auction · <b>${view.active.length} agents</b> bidding on ${esc(row.title as string)}.`, [
    [{ text: "Watch it climb", url: `${env.PUBLIC_URL}/a/${auctionId}` }],
  ]);
}

async function handleUpdate(env: Env, u: TgUpdate): Promise<void> {
  if (u.callback_query) {
    const parts = (u.callback_query.data ?? "").split(":");
    const action = parts[0];
    const cbMsg = u.callback_query.message;
    const chatId = cbMsg?.chat.id;
    // Answer first so the button stops spinning, then strip the keyboard so nothing is double-tapped.
    const toasts: Record<string, string> = {
      confirm: "Capturing payment…",
      delivered: "Releasing payout…",
      express: "Rushing payout…",
      raise: "Raising your max…",
      pick: "Got it — grading…",
      watch: "Watching — I'll ping you",
    };
    await tg(env, "answerCallbackQuery", { callback_query_id: u.callback_query.id, text: toasts[action] });
    let stripped = false;
    if (["confirm", "delivered", "express", "raise"].includes(action) && cbMsg) {
      await tg(env, "editMessageReplyMarkup", { chat_id: cbMsg.chat.id, message_id: cbMsg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      stripped = true;
    }
    try {
      if (action === "confirm") {
        await capture(env, parts[1]);
        // Trusted sellers get the express choice: cash out now (−1% rush) or on delivery (free).
        const snap = await env.DB.prepare(
          `SELECT sn.seller_id, a.clearing_cents FROM auctions a JOIN snaps sn ON sn.id = a.snap_id WHERE a.id = ?`,
        ).bind(parts[1]).first<{ seller_id: string; clearing_cents: number | null }>();
        if (snap && (await expressEligible(env, snap.seller_id))) {
          const { netCents } = splitFee(snap.clearing_cents ?? 0, sellerFeeBps(env));
          const { expressFeeCents, payoutCents } = splitExpress(netCents, expressFeeBps(env));
          if (chatId) {
            await send(env, chatId, `<code>CAPTURED</code> Payment's in. Ship it — or skip the wait:\n⚡ Express payout <b>${usd(payoutCents)}</b> now (−${usd(expressFeeCents)} rush).`, [
              [{ text: `⚡ Express ${usd(payoutCents)}`, callback_data: `express:${parts[1]}` }],
              [{ text: "Delivered (demo)", callback_data: `delivered:${parts[1]}` }],
            ]);
          }
        } else if (chatId) {
          await send(env, chatId, "<code>CAPTURED</code> Payment's in. Ship it, then tap below.", [[{ text: "Delivered (demo)", callback_data: `delivered:${parts[1]}` }]]);
        }
      } else if (action === "express") {
        const { payoutCents } = await releaseExpress(env, parts[1]);
        if (chatId) await send(env, chatId, `<code>EXPRESS PAID ${usd(payoutCents)}</code>\nTransferred to your Stripe account. Happy flipping.`);
      } else if (action === "delivered") {
        await release(env, parts[1]);
      } else if (action === "raise") {
        // Buyer tapped "Raise max" on the dropout ping: raise:<auctionId>:<orderId>:<newMaxCents>
        const [, auctionId, orderId, cents] = parts;
        const order = await env.DB.prepare("SELECT buyer_id FROM orders WHERE id = ?").bind(orderId).first<{ buyer_id: string }>();
        if (!order) throw new Error("unknown order");
        const view = await buyerAgent(env, order.buyer_id).raise(order.buyer_id, auctionId, orderId, Number(cents));
        if (chatId) await send(env, chatId, `<code>BACK IN</code> Max raised to ${usd(Number(cents))}. ${view.active.length} agents still bidding.`, [[{ text: "Watch live", url: `${env.PUBLIC_URL}/a/${auctionId}` }]]);
      } else if (action === "pick") {
        const [, snapId, skuId] = parts;
        const sku = await env.DB.prepare("SELECT title FROM skus WHERE id = ?").bind(skuId).first<{ title: string }>();
        if (chatId && sku) await finalizeIdentification(env, chatId, snapId, skuId, sku.title, cbMsg?.message_id);
      } else if (action === "watch") {
        // Seller armed a "ping me" watch; swap the keyboard for just the demand link.
        await env.DB.prepare("UPDATE watches SET active = 1 WHERE id = ?").bind(parts[1]).run();
        if (cbMsg) {
          await tg(env, "editMessageReplyMarkup", {
            chat_id: cbMsg.chat.id,
            message_id: cbMsg.message_id,
            reply_markup: { inline_keyboard: [[{ text: "What's in demand", url: `${env.PUBLIC_URL}/` }]] },
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Put the original keyboard back before apologizing so the tap can be retried.
      if (stripped && cbMsg?.reply_markup) {
        await tg(env, "editMessageReplyMarkup", { chat_id: cbMsg.chat.id, message_id: cbMsg.message_id, reply_markup: cbMsg.reply_markup }).catch(() => {});
      }
      if (chatId) await send(env, chatId, `Couldn't do that: ${esc((e as Error).message)}\n▸ Try again in a moment.`);
    }
    return;
  }

  const msg = u.message;
  if (!msg) return;
  if (msg.photo?.length) {
    const largest = msg.photo.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
    return handlePhoto(env, msg.chat.id, largest.file_id, "image/jpeg");
  }
  const mime = msg.document?.mime_type ?? "";
  if (msg.document && VISION_TYPES.includes(mime)) return handlePhoto(env, msg.chat.id, msg.document.file_id, mime as ImageType);
  if (msg.sticker) {
    // Telegram turns .webp images into stickers on many clients.
    await send(env, msg.chat.id, "That arrived as a sticker — Telegram does that to .webp images.\n▸ Send it as a <b>photo</b>, or attach it as a <b>file</b>, and I'll read it.");
    return;
  }
  if (msg.document && mime.startsWith("image/")) {
    // e.g. iPhone HEIC sent as a file — vision can't read it, but Telegram converts compressed photos to JPEG.
    await send(env, msg.chat.id, "I can't read that image format.\n▸ Send it as a <b>photo</b> (not a file) and Telegram converts it for me.");
    return;
  }

  const text = msg.text?.trim() ?? "";
  // Buyer linking: t.me/<bot>?start=<buyerId>
  const start = text.match(/^\/start(?:@\w+)?\s+(b_[a-z0-9]+)$/i);
  if (start) {
    const r = await env.DB.prepare("UPDATE buyers SET tg_chat_id = ? WHERE id = ?").bind(String(msg.chat.id), start[1]).run();
    await send(
      env,
      msg.chat.id,
      r.meta.changes
        ? "<code>LINKED</code> Your agent will ping you here when it bids, drops out, or wins."
        : `That link didn't match a buyer.\n▸ <a href="${esc(env.PUBLIC_URL)}/buy">Set a standing order</a> to get a fresh one.`,
      r.meta.changes ? [[{ text: "My standing orders", url: `${env.PUBLIC_URL}/buy/orders` }]] : undefined,
    );
    return;
  }
  if (/^\/(start|help)(@\w+)?$/i.test(text)) {
    await send(
      env,
      msg.chat.id,
      `<b>&gt; snapflip▊</b>\nSold before you buy it.\n\n` +
        `Snap a cartridge you're eyeing on the rack. I'll identify it, grade it, and run a 60-second auction ` +
        `against buyer agents holding real money, before you pay for it.\n\n` +
        `▸ Send a photo, label facing the camera\n▸ Set a floor price\n▸ Watch it climb, then decide`,
      [
        [{ text: "What's in demand", url: `${env.PUBLIC_URL}/` }],
        [{ text: "I collect — set a standing order", url: `${env.PUBLIC_URL}/buy` }],
      ],
    );
    return;
  }
  const price = text.match(/^\$?(\d{1,4}(?:\.\d{1,2})?)$/);
  if (price) return handleReserve(env, msg, Number(price[1]));
  await send(env, msg.chat.id, "Send me a photo of a cartridge to see who wants it.\n▸ Or /help for how it works.");
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

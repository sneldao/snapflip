// Owner: A. Mirrors a live auction into the seller's Telegram chat by editing one message
// in place, so the seller watches the price climb without leaving the bot.
import { esc, tg } from "./telegram";
import { usd } from "./lib/util";
import type { AuctionView, Env } from "./types";

const SPAN_MS = 60_000;
const MIN_GAP_MS = 1_900; // one edit per auction tick; Telegram tolerates ~1 edit/s per chat

const target = new Map<string, { chatId: string; messageId: number }>();
const lastEdit = new Map<string, number>();

export function liveText(v: AuctionView): string {
  const title = esc(v.title);
  if (v.status === "cleared" && v.winner) return `<code>SOLD ${usd(v.winner.priceCents)}</code> ${title} — details below.`;
  if (v.status === "no_sale") return `<code>NO SALE</code> ${title} — nothing cleared your floor.`;
  const left = Math.max(0, v.endsAt - Date.now());
  const filled = Math.min(10, Math.round((10 * (SPAN_MS - Math.min(left, SPAN_MS))) / SPAN_MS));
  const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
  const n = v.active.length;
  // `dropped` is in bidder order, not drop order — the latest exit is the one at the highest price.
  const drop = v.dropped.reduce<AuctionView["dropped"][number] | undefined>((a, b) => (!a || b.atCents >= a.atCents ? b : a), undefined);
  return (
    `<code>LIVE</code> ${title}\n` +
    `<b>${usd(v.priceCents)}</b>  ${bar} ${Math.ceil(left / 1000)}s\n` +
    `${n} agent${n === 1 ? "" : "s"} in` +
    (drop ? `\n${esc(drop.label)} out @ ${usd(drop.atCents)} — ${esc(drop.reason)}` : "") +
    (v.closing ? "\nGOING ONCE…" : "")
  );
}

/** Best-effort: never throws into the auction. `force` bypasses the throttle (drops, close, end). */
export async function pushLive(env: Env, auctionId: string, v: AuctionView, force: boolean): Promise<void> {
  try {
    const now = Date.now();
    if (!force && now - (lastEdit.get(auctionId) ?? 0) < MIN_GAP_MS) return;
    let t = target.get(auctionId);
    if (!t) {
      // The LIVE message is sent just after the auction starts, so early ticks may find nothing yet.
      const row = await env.DB.prepare("SELECT tg_chat_id, tg_message_id FROM auctions WHERE id = ?")
        .bind(auctionId).first<{ tg_chat_id: string | null; tg_message_id: number | null }>();
      if (!row?.tg_chat_id || !row.tg_message_id) return;
      t = { chatId: row.tg_chat_id, messageId: row.tg_message_id };
      target.set(auctionId, t);
    }
    lastEdit.set(auctionId, now);
    await tg(env, "editMessageText", {
      chat_id: t.chatId,
      message_id: t.messageId,
      text: liveText(v),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Watch it climb", url: `${env.PUBLIC_URL}/a/${auctionId}` }]] },
    });
    if (v.status !== "live") {
      target.delete(auctionId);
      lastEdit.delete(auctionId);
    }
  } catch {
    // "message is not modified", rate limits, deleted chats — the web page is the source of truth.
  }
}

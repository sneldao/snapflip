// Owner: B. Ascending clock auction, one Durable Object per auction.
import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { findCandidates } from "./match";
import { settleAuction } from "./payments";
import { notify } from "./telegram";
import { devOnly, newId, nowIso, requireApiKey, type App } from "./lib/util";
import type { AuctionStatus, AuctionView, BidEvent, Env, Snap, Valuation } from "./types";

const TICK_MS = 2_000;
const DURATION_MS = 60_000;
const SOLO_WINDOW_MS = 10_000;
const EXTEND_MS = 10_000;
const MAX_EXTENSIONS = 2;

interface Bidder extends Valuation {
  label: string;
  active: boolean;
  droppedAtCents?: number;
}

interface State {
  id: string;
  snapId: string;
  sellerId: string;
  title: string;
  status: AuctionStatus;
  reserveCents: number;
  priceCents: number;
  incrementCents: number;
  endsAt: number;
  extensions: number;
  bidders: Bidder[];
  events: BidEvent[];
  winner?: { orderId: string; buyerId: string; priceCents: number };
}

export interface StartInput {
  id: string;
  snapId: string;
  sellerId: string;
  title: string;
  reserveCents: number;
  refPriceCents: number;
  candidates: Valuation[];
}

export class AuctionDO extends DurableObject<Env> {
  private s?: State;

  private async load(): Promise<State | undefined> {
    this.s ??= await this.ctx.storage.get<State>("s");
    return this.s;
  }

  private async save(s: State): Promise<void> {
    this.s = s;
    await this.ctx.storage.put("s", s);
  }

  async start(input: StartInput): Promise<AuctionView> {
    if (await this.load()) throw new Error("auction already started");
    const now = Date.now();
    const bidders: Bidder[] = input.candidates
      .filter((v) => v.eligible && v.dropoutCents >= input.reserveCents)
      .map((v, i) => ({ ...v, label: `Agent #${i + 1}`, active: true }));

    const s: State = {
      id: input.id,
      snapId: input.snapId,
      sellerId: input.sellerId,
      title: input.title,
      status: "live",
      reserveCents: input.reserveCents,
      priceCents: input.reserveCents,
      incrementCents: Math.max(100, Math.round((input.refPriceCents * 0.05) / 100) * 100),
      endsAt: now + (bidders.length === 1 ? SOLO_WINDOW_MS : DURATION_MS),
      extensions: 0,
      bidders,
      events: bidders.map((b) => ({ orderId: b.orderId, event: "join", priceCents: input.reserveCents, reason: b.reason, at: nowIso() })),
    };

    if (bidders.length === 0) {
      await this.finish(s, undefined);
    } else {
      await this.save(s);
      await this.ctx.storage.setAlarm(bidders.length === 1 ? s.endsAt : now + TICK_MS);
    }
    return this.view(s);
  }

  async alarm(): Promise<void> {
    const s = await this.load();
    if (!s || s.status !== "live") return;
    const now = Date.now();
    const active = s.bidders.filter((b) => b.active);

    // Solo bidder: wins at reserve once the join window closes.
    if (s.bidders.length === 1) {
      if (now >= s.endsAt) return this.finish(s, active[0], s.reserveCents);
      await this.save(s);
      await this.ctx.storage.setAlarm(s.endsAt);
      return;
    }

    const next = s.priceCents + s.incrementCents;
    const stay = active.filter((b) => b.dropoutCents >= next);

    // Everyone left at once: highest value (earliest order on ties) wins at the current price.
    if (stay.length === 0) return this.finish(s, highest(active), s.priceCents);

    for (const b of active) {
      if (stay.includes(b)) continue;
      b.active = false;
      b.droppedAtCents = next;
      s.events.push({ orderId: b.orderId, event: "drop", priceCents: next, reason: b.reason, at: nowIso() });
      // Buyer can raise their max (soft close). Fire and forget.
      this.ctx.waitUntil(
        notify(this.env, { buyerId: b.buyerId }, {
          type: "agent_dropped", auctionId: s.id, orderId: b.orderId, title: s.title, atCents: next, reason: b.reason,
        }).catch((e) => console.error("notify failed", e)),
      );
    }
    s.priceCents = next;

    if (stay.length === 1) return this.finish(s, stay[0], next);
    if (now >= s.endsAt) return this.finish(s, highest(stay), next);

    await this.save(s);
    this.broadcast(s);
    await this.ctx.storage.setAlarm(now + TICK_MS);
  }

  /** Buyer raised their max after dropping (called via BuyerAgent, which checks ownership). */
  async raise(orderId: string, newMaxCents: number): Promise<AuctionView> {
    const s = await this.load();
    if (!s || s.status !== "live") throw new Error("auction not live");
    const b = s.bidders.find((x) => x.orderId === orderId);
    if (!b) throw new Error("order not in this auction");
    b.dropoutCents = Math.min(Math.max(b.dropoutCents, newMaxCents), b.limitCents);
    if (!b.active && b.dropoutCents >= s.priceCents + s.incrementCents) {
      b.active = true;
      b.droppedAtCents = undefined;
      if (s.extensions < MAX_EXTENSIONS && s.endsAt - Date.now() < EXTEND_MS) {
        s.endsAt += EXTEND_MS;
        s.extensions++;
      }
    }
    s.events.push({ orderId, event: "raise", priceCents: b.dropoutCents, at: nowIso() });
    await this.save(s);
    this.broadcast(s);
    return this.view(s);
  }

  async getView(): Promise<AuctionView | null> {
    const s = await this.load();
    return s ? this.view(s) : null;
  }

  /** WebSocket for the live /a/{id} page and the seller UI (hibernatable). */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const s = await this.load();
    if (s) server.send(JSON.stringify(this.view(s)));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(): Promise<void> {
    // Read-only feed; ignore client messages.
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code, "closing");
  }

  private async finish(s: State, winner: Bidder | undefined, priceCents = s.priceCents): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    s.status = winner ? "cleared" : "no_sale";
    if (winner) {
      s.winner = { orderId: winner.orderId, buyerId: winner.buyerId, priceCents };
      s.priceCents = priceCents;
      s.events.push({ orderId: winner.orderId, event: "win", priceCents, at: nowIso() });
    }
    await this.save(s);
    this.broadcast(s);
    await this.persistAndSettle(s, winner);
  }

  private async persistAndSettle(s: State, winner: Bidder | undefined): Promise<void> {
    const db = this.env.DB;
    await db.batch([
      db.prepare("UPDATE auctions SET status = ?, ended_at = ?, clearing_cents = ?, winner_order_id = ? WHERE id = ?")
        .bind(s.status, nowIso(), winner ? s.priceCents : null, winner?.orderId ?? null, s.id),
      ...s.events.map((e) =>
        db.prepare("INSERT INTO bids (auction_id, order_id, event, price_cents, reason, at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(s.id, e.orderId, e.event, e.priceCents, e.reason ?? null, e.at),
      ),
    ]);

    if (!winner) {
      await notify(this.env, { sellerId: s.sellerId }, { type: "no_sale", auctionId: s.id, title: s.title });
      return;
    }

    // Winner first, then fallbacks at their own dropout price (if the winner's card fails).
    const fallbacks = s.bidders
      .filter((b) => b.orderId !== winner.orderId && b.dropoutCents >= s.reserveCents)
      .sort((a, b) => b.dropoutCents - a.dropoutCents)
      .map((b) => ({ orderId: b.orderId, priceCents: b.dropoutCents }));
    const result = await settleAuction(this.env, s.id, [{ orderId: winner.orderId, priceCents: s.priceCents }, ...fallbacks]);

    if (!result.ok) {
      await db.prepare("UPDATE auctions SET status = 'failed' WHERE id = ?").bind(s.id).run();
      await notify(this.env, { sellerId: s.sellerId }, { type: "no_sale", auctionId: s.id, title: s.title });
      return;
    }

    const buyer = s.bidders.find((b) => b.orderId === result.orderId)!;
    const feeBps = Number(this.env.SELLER_FEE_BPS || "1000");
    const netCents = result.priceCents - Math.round((result.priceCents * feeBps) / 10_000);
    await db.batch([
      db.prepare("UPDATE auctions SET status = 'settled', payment_intent_id = ?, winner_order_id = ?, clearing_cents = ? WHERE id = ?")
        .bind(result.paymentIntentId, result.orderId, result.priceCents, s.id),
      db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").bind(result.orderId),
    ]);
    await notify(this.env, { buyerId: buyer.buyerId }, { type: "auction_won", auctionId: s.id, title: s.title, priceCents: result.priceCents });
    await notify(this.env, { sellerId: s.sellerId }, { type: "presold", auctionId: s.id, title: s.title, priceCents: result.priceCents, netCents });
  }

  private broadcast(s: State): void {
    const msg = JSON.stringify(this.view(s));
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // socket already gone
      }
    }
  }

  private view(s: State): AuctionView {
    const winner = s.winner && s.bidders.find((b) => b.orderId === s.winner!.orderId);
    return {
      type: "state",
      id: s.id,
      snapId: s.snapId,
      title: s.title,
      status: s.status,
      priceCents: s.priceCents,
      reserveCents: s.reserveCents,
      endsAt: s.endsAt,
      active: s.bidders.filter((b) => b.active).map((b) => ({ orderId: b.orderId, label: b.label })),
      dropped: s.bidders
        .filter((b) => !b.active)
        .map((b) => ({ orderId: b.orderId, label: b.label, atCents: b.droppedAtCents ?? s.priceCents, reason: b.reason })),
      winner: s.winner && winner ? { orderId: s.winner.orderId, label: winner.label, priceCents: s.winner.priceCents } : undefined,
    };
  }
}

function highest(bs: Bidder[]): Bidder {
  // Stable: earlier bidders (earlier orders) win ties.
  return bs.reduce((best, b) => (b.dropoutCents > best.dropoutCents ? b : best));
}

export function auctionStub(env: Env, auctionId: string) {
  return env.AUCTION.get(env.AUCTION.idFromName(auctionId));
}

/** HANDOFF A → B. Seller set a reserve on a snap; start the auction. */
export async function startAuction(env: Env, snap: Snap, reserveCents: number): Promise<{ auctionId: string; view: AuctionView }> {
  const sku = snap.skuId
    ? await env.DB.prepare("SELECT ref_price_cents FROM skus WHERE id = ?").bind(snap.skuId).first<{ ref_price_cents: number }>()
    : null;
  const candidates = await findCandidates(env, snap);
  const auctionId = newId("a");
  await env.DB.prepare("INSERT INTO auctions (id, snap_id, status, reserve_cents) VALUES (?, ?, 'live', ?)")
    .bind(auctionId, snap.id, reserveCents)
    .run();
  const view = await auctionStub(env, auctionId).start({
    id: auctionId,
    snapId: snap.id,
    sellerId: snap.sellerId,
    title: snap.title,
    reserveCents,
    refPriceCents: sku?.ref_price_cents ?? reserveCents * 3,
    candidates,
  });
  return { auctionId, view };
}

export const auctions = new Hono<App>();

auctions.get("/a/:id/ws", (c) => auctionStub(c.env, c.req.param("id")).fetch(c.req.raw));

auctions.get("/api/auctions/:id", async (c) => {
  const view = await auctionStub(c.env, c.req.param("id")).getView();
  return view ? c.json(view) : c.json({ error: "not found" }, 404);
});

/** Dev only: fake a snap of the seeded hero item and run an auction against the seeded orders. */
auctions.post("/dev/fake-auction", devOnly, requireApiKey, async (c) => {
  const body = await c.req.json<{ grade?: Snap["grade"]; reserveCents?: number }>().catch(() => ({}) as { grade?: Snap["grade"]; reserveCents?: number });
  const snap: Snap = {
    id: newId("sn"),
    sellerId: "s_demo",
    r2Key: "snaps/fake.jpg",
    skuId: "gb-pokemon-yellow-us",
    title: "Pokemon Yellow Version",
    confidence: 1,
    grade: body.grade ?? "B",
    gradeNotes: "fake snap",
    flags: [],
    rackCents: 600,
    reserveCents: body.reserveCents ?? 1000,
  };
  await c.env.DB.prepare(
    "INSERT INTO snaps (id, seller_id, r2_key, sku_id, confidence, grade, grade_notes, rack_cents, reserve_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(snap.id, snap.sellerId, snap.r2Key, snap.skuId, snap.confidence, snap.grade, snap.gradeNotes, snap.rackCents, snap.reserveCents).run();
  const { auctionId, view } = await startAuction(c.env, snap, snap.reserveCents!);
  return c.json({ auctionId, url: `${c.env.PUBLIC_URL}/a/${auctionId}`, view });
});

// Owner: B. Ascending clock auction, one Durable Object per auction.
import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { findCandidates } from "./match";
import { settleAuction } from "./payments";
import { notify } from "./telegram";
import { PLATFORM_FEES_DDL, feeLedgerRow, sellerFeeBps, splitFee } from "./lib/fees";
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
  /** True during a "going once, going twice" grace window: one bidder stands, the price holds,
   *  and a just-dropped agent can still raise back in. */
  closing?: boolean;
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

    // Soft-close grace: one bidder stands, price holds, dropped agents may raise back in.
    if (s.closing) {
      if (active.length >= 2) {
        // A raise made it competitive again — resume the clock.
        s.closing = false;
        await this.save(s);
        this.broadcast(s);
        await this.ctx.storage.setAlarm(now + TICK_MS);
        return;
      }
      if (now >= s.endsAt) return this.finish(s, active[0] ?? highest(s.bidders), s.priceCents);
      await this.ctx.storage.setAlarm(Math.min(s.endsAt, now + TICK_MS));
      return;
    }

    const next = s.priceCents + s.incrementCents;
    const stay = active.filter((b) => b.dropoutCents >= next);

    // Everyone caps out at once: highest value (earliest order on ties) wins at the current price.
    if (stay.length === 0) return this.finish(s, highest(active), s.priceCents);

    for (const b of active) {
      if (stay.includes(b)) continue;
      b.active = false;
      b.droppedAtCents = next;
      s.events.push({ orderId: b.orderId, event: "drop", priceCents: next, reason: b.reason, at: nowIso() });
      // Ping the buyer so they can raise their max. Fire and forget.
      this.ctx.waitUntil(
        notify(this.env, { buyerId: b.buyerId }, {
          type: "agent_dropped", auctionId: s.id, orderId: b.orderId, title: s.title, atCents: next, reason: b.reason,
        }).catch((e) => console.error("notify failed", e)),
      );
    }
    s.priceCents = next;

    // One bidder left standing: open a soft-close window instead of finishing, so a just-dropped
    // agent has a chance to raise back in. Finishes now if no extensions remain.
    if (stay.length === 1) return this.enterClosingOrFinish(s, now, stay[0], next);
    if (now >= s.endsAt) return this.finish(s, highest(stay), next);

    await this.save(s);
    this.broadcast(s);
    await this.ctx.storage.setAlarm(now + TICK_MS);
  }

  private async enterClosingOrFinish(s: State, now: number, standing: Bidder, priceCents: number): Promise<void> {
    s.priceCents = priceCents;
    // No grace left, or nobody to bring back: settle now.
    if (s.extensions >= MAX_EXTENSIONS || !s.bidders.some((b) => !b.active)) {
      return this.finish(s, standing, priceCents);
    }
    s.closing = true;
    s.extensions++;
    s.endsAt = now + EXTEND_MS;
    await this.save(s);
    this.broadcast(s);
    await this.ctx.storage.setAlarm(s.endsAt);
  }

  /**
   * Buyer raised their max. `authorizedMaxCents` has already been checked against the buyer's
   * payment limit by BuyerAgent, so here it becomes the bidder's new ceiling and dropout.
   */
  async raise(orderId: string, authorizedMaxCents: number): Promise<AuctionView> {
    const s = await this.load();
    if (!s || s.status !== "live") throw new Error("auction not live");
    const b = s.bidders.find((x) => x.orderId === orderId);
    if (!b) throw new Error("order not in this auction");

    b.limitCents = Math.max(b.limitCents, authorizedMaxCents);
    b.dropoutCents = Math.max(b.dropoutCents, authorizedMaxCents);
    // Rejoin if the new max covers the current price (during a soft close) or the next tick.
    const threshold = s.closing ? s.priceCents : s.priceCents + s.incrementCents;
    if (!b.active && b.dropoutCents >= threshold) {
      b.active = true;
      b.droppedAtCents = undefined;
    }
    b.reason = `raised to $${Math.round(b.dropoutCents / 100)}`;
    s.events.push({ orderId, event: "raise", priceCents: b.dropoutCents, at: nowIso() });

    // If a soft close is now competitive again, resume the clock immediately with fresh runway.
    const now = Date.now();
    if (s.closing && s.bidders.filter((x) => x.active).length >= 2) {
      s.closing = false;
      s.endsAt = now + EXTEND_MS;
      await this.save(s);
      this.broadcast(s);
      await this.ctx.storage.setAlarm(now + TICK_MS);
      return this.view(s);
    }

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
    // Ledger must exist on DBs created before it was added to schema.sql.
    await db.prepare(PLATFORM_FEES_DDL).run();
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

    // Winner first, then fallbacks — all at the SAME clearing price (the price the clock
    // stopped at). Only bidders whose dropout covers the clearing price can step in, so a
    // fallback never pays its own (higher) dropout.
    const fallbacks = s.bidders
      .filter((b) => b.orderId !== winner.orderId && b.dropoutCents >= s.priceCents)
      .sort((a, b) => b.dropoutCents - a.dropoutCents)
      .map((b) => ({ orderId: b.orderId, priceCents: s.priceCents }));
    const result = await settleAuction(this.env, s.id, [{ orderId: winner.orderId, priceCents: s.priceCents }, ...fallbacks]);

    if (!result.ok) {
      await db.prepare("UPDATE auctions SET status = 'failed' WHERE id = ?").bind(s.id).run();
      await notify(this.env, { sellerId: s.sellerId }, { type: "settlement_failed", auctionId: s.id, title: s.title, reason: result.reason });
      return;
    }

    const buyer = s.bidders.find((b) => b.orderId === result.orderId)!;
    const feeBps = sellerFeeBps(this.env);
    const { netCents } = splitFee(result.priceCents, feeBps);
    const ledger = feeLedgerRow(s.id, result.priceCents, feeBps);
    await db.batch([
      db.prepare("UPDATE auctions SET status = 'settled', payment_intent_id = ?, winner_order_id = ?, clearing_cents = ? WHERE id = ?")
        .bind(result.paymentIntentId, result.orderId, result.priceCents, s.id),
      db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").bind(result.orderId),
      // Fee snapshot: history stays correct even if SELLER_FEE_BPS changes later.
      db.prepare("INSERT OR IGNORE INTO platform_fees (auction_id, clearing_cents, fee_bps, fee_cents) VALUES (?, ?, ?, ?)")
        .bind(ledger.auction_id, ledger.clearing_cents, ledger.fee_bps, ledger.fee_cents),
    ]);
    const wonOrder = await db.prepare("SELECT max_cents FROM orders WHERE id = ?").bind(result.orderId).first<{ max_cents: number }>();
    const wonMaxCents = wonOrder?.max_cents ?? buyer.limitCents;
    await notify(this.env, { buyerId: buyer.buyerId }, { type: "auction_won", auctionId: s.id, title: s.title, priceCents: result.priceCents, maxCents: wonMaxCents });
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
    const feeBps = sellerFeeBps(this.env);
    const fee = s.winner ? splitFee(s.winner.priceCents, feeBps) : null;
    return {
      type: "state",
      id: s.id,
      snapId: s.snapId,
      title: s.title,
      status: s.status,
      priceCents: s.priceCents,
      reserveCents: s.reserveCents,
      endsAt: s.endsAt,
      closing: s.closing === true,
      feeBps,
      active: s.bidders.filter((b) => b.active).map((b) => ({ orderId: b.orderId, label: b.label })),
      dropped: s.bidders
        .filter((b) => !b.active)
        .map((b) => ({ orderId: b.orderId, label: b.label, atCents: b.droppedAtCents ?? s.priceCents, reason: b.reason })),
      winner: s.winner && winner && fee
        ? {
            orderId: s.winner.orderId,
            label: winner.label,
            priceCents: s.winner.priceCents,
            feeBps,
            feeCents: fee.feeCents,
            netCents: fee.netCents,
          }
        : undefined,
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

/** Photo of the snapped item, streamed from R2 for the live auction page. */
auctions.get("/a/:id/photo", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT sn.r2_key FROM auctions a JOIN snaps sn ON sn.id = a.snap_id WHERE a.id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ r2_key: string }>();
  if (!row) return c.notFound();
  const obj = await c.env.PHOTOS.get(row.r2_key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "image/jpeg");
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

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

// Owner: B. One BuyerAgent per buyer (Agents SDK). Holds per-buyer state and checks ownership
// before acting on the buyer's behalf. Address it with env.BUYER.idFromName(buyerId).
import { Agent } from "agents";
import { auctionStub } from "./auction";
import type { AuctionView, Env } from "./types";

interface BuyerState {
  raises: number;
  lastAuctionId?: string;
}

export class BuyerAgent extends Agent<Env, BuyerState> {
  initialState: BuyerState = { raises: 0 };

  /**
   * Human override: raise the max on an order in a live auction. The buyer's payment limit is the
   * hard ceiling — a raise can lift the order max up to it, and we persist the new max so it carries
   * beyond this auction. The authorized value is what the auction (and later settlement) enforces.
   */
  async raise(buyerId: string, auctionId: string, orderId: string, newMaxCents: number): Promise<AuctionView> {
    const row = await this.env.DB.prepare(
      `SELECT o.buyer_id, o.max_cents, b.limit_cents, b.limit_expires_at
         FROM orders o JOIN buyers b ON b.id = o.buyer_id WHERE o.id = ?`,
    )
      .bind(orderId)
      .first<{ buyer_id: string; max_cents: number; limit_cents: number; limit_expires_at: string | null }>();
    if (!row || row.buyer_id !== buyerId) throw new Error("not your order");
    if (row.limit_expires_at && row.limit_expires_at < new Date().toISOString()) throw new Error("payment limit expired");

    // The payment limit is the true ceiling; never authorize above it.
    const authorizedMax = Math.min(Math.round(newMaxCents), row.limit_cents);
    if (authorizedMax <= row.max_cents) {
      throw new Error(`raise must exceed the current max of ${row.max_cents}c (payment limit ${row.limit_cents}c)`);
    }

    // Persist the higher max so this order keeps it in future auctions too.
    await this.env.DB.prepare("UPDATE orders SET max_cents = ? WHERE id = ?").bind(authorizedMax, orderId).run();
    const view = await auctionStub(this.env, auctionId).raise(orderId, authorizedMax);
    this.setState({ raises: this.state.raises + 1, lastAuctionId: auctionId });
    return view;
  }
}

export function buyerAgent(env: Env, buyerId: string) {
  return env.BUYER.get(env.BUYER.idFromName(buyerId));
}

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

  /** Human override: raise the max on an order that dropped out of a live auction. */
  async raise(buyerId: string, auctionId: string, orderId: string, newMaxCents: number): Promise<AuctionView> {
    const order = await this.env.DB.prepare("SELECT buyer_id FROM orders WHERE id = ?").bind(orderId).first<{ buyer_id: string }>();
    if (!order || order.buyer_id !== buyerId) throw new Error("not your order");
    // The auction clamps to min(order max, payment limit). TODO(B): let a raise also lift the order max, within the payment limit.
    const view = await auctionStub(this.env, auctionId).raise(orderId, newMaxCents);
    this.setState({ raises: this.state.raises + 1, lastAuctionId: auctionId });
    return view;
  }
}

export function buyerAgent(env: Env, buyerId: string) {
  return env.BUYER.get(env.BUYER.idFromName(buyerId));
}

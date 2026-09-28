// Money-math unit tests. Run with `npm test` (node:test, no dependencies).
// Covers src/lib/fees.ts: every cent of take rate, rush fee, and ledger math.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXPRESS_FEE_BPS,
  DEFAULT_FEE_BPS,
  expressFeeBps,
  feeLedgerRow,
  feePct,
  PLUS_MONTHLY_CENTS,
  sellerFeeBps,
  splitExpress,
  splitFee,
} from "../src/lib/fees.ts";

describe("sellerFeeBps", () => {
  it("defaults to 10% when unset", () => {
    assert.equal(sellerFeeBps({}), DEFAULT_FEE_BPS);
    assert.equal(sellerFeeBps({}), 1000);
  });
  it("parses a valid rate", () => {
    assert.equal(sellerFeeBps({ SELLER_FEE_BPS: "500" }), 500);
  });
  it("rejects garbage, negatives, and >100%", () => {
    for (const bad of ["abc", "", "-1", "10001", "NaN"]) {
      assert.equal(sellerFeeBps({ SELLER_FEE_BPS: bad }), DEFAULT_FEE_BPS, bad);
    }
  });
});

describe("splitFee", () => {
  it("splits the $38 demo sale exactly", () => {
    assert.deepEqual(splitFee(3800, 1000), { feeCents: 380, netCents: 3420 });
  });
  it("fee + net always equals clearing (no lost cents)", () => {
    for (const clearing of [1, 99, 100, 101, 9999, 100000]) {
      const { feeCents, netCents } = splitFee(clearing, 1000);
      assert.equal(feeCents + netCents, clearing, `$${clearing / 100}`);
    }
  });
  it("rounds half up", () => {
    // 1¢ at 10% = 0.1¢ → 0¢ fee; 5¢ → 0.5¢ → 1¢ fee.
    assert.equal(splitFee(1, 1000).feeCents, 0);
    assert.equal(splitFee(5, 1000).feeCents, 1);
  });
});

describe("splitExpress", () => {
  it("carves 1% out of the $34.20 net", () => {
    assert.deepEqual(splitExpress(3420, 100), { expressFeeCents: 34, payoutCents: 3386 });
  });
  it("never overpays: rush + payout equals net", () => {
    for (const net of [1, 100, 3420, 99999]) {
      const { expressFeeCents, payoutCents } = splitExpress(net, 100);
      assert.equal(expressFeeCents + payoutCents, net);
    }
  });
  it("defaults to 1% and rejects bad config", () => {
    assert.equal(expressFeeBps({}), DEFAULT_EXPRESS_FEE_BPS);
    assert.equal(expressFeeBps({ EXPRESS_FEE_BPS: "nope" }), DEFAULT_EXPRESS_FEE_BPS);
  });
});

describe("feeLedgerRow", () => {
  it("snapshots exactly what settle writes", () => {
    assert.deepEqual(feeLedgerRow("a_123", 3800, 1000), {
      auction_id: "a_123",
      clearing_cents: 3800,
      fee_bps: 1000,
      fee_cents: 380,
    });
  });
  it("pins a historic rate even after the env changes", () => {
    // Rate change tomorrow must not rewrite yesterday's row.
    assert.equal(feeLedgerRow("a_old", 3800, 1000).fee_cents, 380);
    assert.equal(feeLedgerRow("a_new", 3800, 1500).fee_cents, 570);
  });
});

describe("labels and prices", () => {
  it("formats basis points for humans", () => {
    assert.equal(feePct(1000), "10%");
    assert.equal(feePct(100), "1%");
  });
  it("Plus is priced at $6/mo", () => {
    assert.equal(PLUS_MONTHLY_CENTS, 600);
  });
});

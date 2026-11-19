// Badge-gate unit tests. Run with `npm test` (node:test, no dependencies).
// Covers src/lib/concordium.ts: verdict parsing, the gate flag, and admitBidders —
// including fail-closed behaviour when the registry is unreachable.
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { admitBidders, badgeGateEnabled, badgeVerdictFromResponse, bindAgentBadge, buildAgentCard } from "../src/lib/concordium.ts";
import { assetPrice, settleRail, x402Enabled } from "../src/lib/x402.ts";
import { chainEvents, RECEIPT_GENESIS } from "../src/lib/receipts.ts";

const val = (orderId: string, badge?: string | null) => ({
  orderId,
  buyerId: `b_${orderId}`,
  eligible: true,
  dropoutCents: 5000,
  limitCents: 5000,
  reason: "test",
  badge,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("badgeGateEnabled", () => {
  it("defaults off — unset or anything but true/1", () => {
    for (const env of [{}, { REQUIRE_AGENT_BADGE: "false" }, { REQUIRE_AGENT_BADGE: "yes" }]) {
      assert.equal(badgeGateEnabled(env), false);
    }
  });
  it("on for true or 1", () => {
    assert.equal(badgeGateEnabled({ REQUIRE_AGENT_BADGE: "true" }), true);
    assert.equal(badgeGateEnabled({ REQUIRE_AGENT_BADGE: "1" }), true);
  });
});

describe("badgeVerdictFromResponse", () => {
  it("accepts the single-badge form", () => {
    const v = badgeVerdictFromResponse(200, { badge_valid: true }, "4xYz");
    assert.equal(v.verified, true);
    assert.equal(v.agents, 1);
  });
  it("accepts the account form", () => {
    const v = badgeVerdictFromResponse(200, { summary: { valid: 2 } }, "acct");
    assert.equal(v.verified, true);
    assert.equal(v.agents, 2);
  });
  it("refuses invalid badges and non-200s", () => {
    assert.equal(badgeVerdictFromResponse(200, { badge_valid: false, issues: ["revoked"] }, "x").verified, false);
    assert.equal(badgeVerdictFromResponse(500, { error: "boom" }, "x").verified, false);
    assert.equal(badgeVerdictFromResponse(0, {}, "x").verified, false);
    assert.equal(badgeVerdictFromResponse(200, { summary: { valid: 0 } }, "x").verified, false);
  });
});

describe("admitBidders", () => {
  it("gate off admits everyone without network calls", async () => {
    globalThis.fetch = () => {
      throw new Error("fetch should not be called");
    };
    const { admitted, refused } = await admitBidders({}, [val("o1"), val("o2", "badge")]);
    assert.equal(admitted.length, 2);
    assert.equal(refused.length, 0);
  });

  it("gate on refuses missing and rejected badges, admits verified", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      const ok = url.includes("good-badge") || url.includes("bind-good-badge");
      return new Response(JSON.stringify({ badge_valid: ok, issues: ok ? [] : ["not found"] }), { status: 200 });
    };
    const env = { REQUIRE_AGENT_BADGE: "1" };
    const { admitted, refused } = await admitBidders(env, [val("o1", "good-badge"), val("o2"), val("o3", "bad-badge")]);
    assert.deepEqual(admitted.map((v) => v.orderId), ["o1"]);
    assert.deepEqual(refused.map((r) => r.orderId), ["o2", "o3"]);
    assert.match(refused[0].reason, /no Verified by Concordium badge/);
    assert.match(refused[1].reason, /not found/);
  });

  it("fails closed when the registry is unreachable", async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const { admitted, refused } = await admitBidders({ REQUIRE_AGENT_BADGE: "true" }, [val("o1", "any-badge")]);
    assert.equal(admitted.length, 0);
    assert.equal(refused.length, 1);
    assert.match(refused[0].reason, /badge rejected/);
  });
});

// Minimal D1 stub: prepare() returns bind/run/first/all chains that never error.
const fakeDb = (rows: Record<string, unknown>[] = []) => ({
  prepare: () => ({
    bind: () => ({ run: async () => ({}), first: async () => rows[0] ?? null, all: async () => ({ results: rows }) }),
    run: async () => ({}),
    first: async () => rows[0] ?? null,
    all: async () => ({ results: rows }),
  }),
});

describe("bindAgentBadge", () => {
  const env = () => ({ DB: fakeDb(), CCD_REGISTRY_API: "https://registry.test" });
  it("binds a verified badge and records the owner account", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("badge-check")) return new Response(JSON.stringify({ badge_valid: true }), { status: 200 });
      if (url.includes("get-badge-JSON")) return new Response(JSON.stringify({ owner: "3ccdOwner" }), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    };
    const r = await bindAgentBadge(env() as never, "buyer1", "bind-good-badge");
    assert.equal(r.badge, "bind-good-badge");
    assert.equal(r.ccdAccount, "3ccdOwner");
  });
  it("refuses to bind a badge the registry rejects", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ badge_valid: false, issues: ["revoked"] }), { status: 200 });
    // Unique badge id: checkBadge caches verdicts for 60s across tests in this file.
    await assert.rejects(() => bindAgentBadge(env() as never, "buyer1", "revoked-badge"), /revoked/);
  });
});

describe("x402Enabled", () => {
  it("needs both facilitator and payee", () => {
    assert.equal(x402Enabled({}), false);
    assert.equal(x402Enabled({ X402_FACILITATOR_URL: "https://f" }), false);
    assert.equal(x402Enabled({ X402_PAYEE: "acct" }), false);
    assert.equal(x402Enabled({ X402_FACILITATOR_URL: "https://f", X402_PAYEE: "acct" }), true);
  });
});

describe("settleRail", () => {
  const configured = { SETTLE_RAIL: "x402", X402_FACILITATOR_URL: "https://f", X402_PAYEE: "acct" };
  it("defaults to stripe", () => {
    assert.equal(settleRail({}), "stripe");
    assert.equal(settleRail({ X402_FACILITATOR_URL: "https://f", X402_PAYEE: "acct" }), "stripe");
  });
  it("x402 needs both the flag and a configured gate", () => {
    assert.equal(settleRail(configured), "x402");
    assert.equal(settleRail({ SETTLE_RAIL: "x402" }), "stripe");
    assert.equal(settleRail({ ...configured, X402_PAYEE: undefined }), "stripe");
  });
});

describe("assetPrice", () => {
  it("defaults to a dollar price", () => {
    assert.equal(assetPrice({}, 0.05), "$0.05");
    assert.equal(assetPrice({}, 12.5), "$12.50");
  });
  it("emits atomic asset units when X402_ASSET is set", () => {
    assert.deepEqual(assetPrice({ X402_ASSET: "EURQ" }, 0.05), { amount: "50000", asset: "EURQ" });
    assert.deepEqual(assetPrice({ X402_ASSET: "EURQ" }, 12.5), { amount: "12500000", asset: "EURQ" });
  });
  it("honours X402_ASSET_DECIMALS", () => {
    assert.deepEqual(assetPrice({ X402_ASSET: "X", X402_ASSET_DECIMALS: "2" }, 1.25), { amount: "125", asset: "X" });
  });
});

describe("chainEvents", () => {
  const ev = (orderId: string, event: "join" | "drop" | "refused", priceCents = 1000, reason?: string) => ({
    orderId, event, priceCents, reason, at: "2026-11-22T00:00:00Z",
  });
  it("is deterministic and starts from genesis", async () => {
    const a = await chainEvents([ev("o1", "join"), ev("o2", "refused", 1000, "no badge")]);
    const b = await chainEvents([ev("o1", "join"), ev("o2", "refused", 1000, "no badge")]);
    assert.deepEqual(a, b);
    assert.equal(a[1].hash, a[a.length - 1].hash);
    assert.notEqual(a[0].hash, RECEIPT_GENESIS);
  });
  it("is tamper-evident — any field change moves the head", async () => {
    const base = [ev("o1", "join"), ev("o2", "drop", 1200)];
    const head = (es: typeof base) => chainEvents(es).then((c) => c[c.length - 1].hash);
    const h0 = await head(base);
    assert.notEqual(await head([ev("o1", "join"), ev("o2", "drop", 1201)]), h0);
    assert.notEqual(await head([ev("o1", "join", 1000, "reason changed"), ev("o2", "drop", 1200)]), h0);
    assert.notEqual(await head([ev("o2", "drop", 1200), ev("o1", "join")]), h0);
  });
});

describe("buildAgentCard", () => {
  const base = { PUBLIC_URL: "https://go.snapflip.workers.dev" };
  it("omits badge extension and registrations before the fleet is registered", () => {
    const card = buildAgentCard(base) as {
      capabilities: { extensions: unknown[] };
      registrations: unknown[];
    };
    assert.equal(card.capabilities.extensions.length, 0);
    assert.equal(card.registrations.length, 0);
  });
  it("embeds badge + registration once env is set", () => {
    const card = buildAgentCard({
      ...base,
      SNAPFLIP_AGENT_BADGE: "4abC",
      AGENT_TOKEN_ID: "7",
      AGENT_OWNER_ACCOUNT: "acct123",
      REGISTRY_CONTRACT: "10456.0",
    }) as { capabilities: { extensions: { params: { tokenAddress: string } }[] }; registrations: { agentId: number }[] };
    assert.equal(card.capabilities.extensions.length, 1);
    assert.match(card.capabilities.extensions[0].params.tokenAddress, /^ccd:[0-9a-f]+\/cis-2:4abC$/);
    assert.equal(card.registrations[0].agentId, 7);
  });
  it("is deterministic — same env, same bytes", () => {
    const env = { ...base, SNAPFLIP_AGENT_BADGE: "b", REGISTRY_CONTRACT: "1.0" };
    assert.equal(JSON.stringify(buildAgentCard(env)), JSON.stringify(buildAgentCard(env)));
  });
});

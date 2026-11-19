// Owner: E. Anchor an auction's receipt hash on-chain via the SnapFlip agent's own
// registry NFT metadata — no custom contract needed. Steps:
//   1. fetch the live receipt head from /api/auctions/:id/receipts
//   2. call the hosted Agent Registry MCP build_set_metadata for a sign-ready payload
//   3. sign it in the Concordium wallet (wallet step — this script never holds keys)
// Wallet-independent today: the head hash and the build payload are both printable.
//   node scripts/anchor-receipt.mjs <auctionId> [--url http://localhost:8787] [--badge <token_address>]
import { createHash } from "node:crypto";

const [auctionId, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const baseUrl = flag("--url") ?? process.env.PUBLIC_URL ?? "http://localhost:8787";
const badge = flag("--badge") ?? process.env.SNAPFLIP_AGENT_BADGE;
const MCP = "https://agent-registry-mcp.concordium.com/mcp";

if (!auctionId) {
  console.log("usage: node scripts/anchor-receipt.mjs <auctionId> [--url <base>] [--badge <token_address>]");
  process.exit(1);
}

const r = await fetch(`${baseUrl}/api/auctions/${auctionId}/receipts`);
if (!r.ok) throw new Error(`receipts fetch ${r.status}: ${(await r.text()).slice(0, 300)}`);
const { head } = await r.json();
console.log(`receipt head: ${head}`);
console.log(`anchoring under key "receipt:${auctionId}"${badge ? ` on agent badge ${badge}` : " (no --badge; build only)"}`);

if (!badge) {
  console.log("\nno badge — nothing more to build. Set SNAPFLIP_AGENT_BADGE once the fleet is registered.");
  process.exit(0);
}

const call = await fetch(MCP, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: {
      name: "build_set_metadata",
      arguments: {
        network: "testnet",
        token_address: badge,
        metadata: { [`receipt:${auctionId}`]: head },
      },
    },
  }),
});
const text = await call.text();
let out;
try { out = JSON.parse(text); } catch {
  // SSE response — take the data: line
  out = JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}");
}
console.log("\nsign-ready payload from build_set_metadata:");
console.log(JSON.stringify(out.result ?? out, null, 2));
console.log("\n→ paste this payload into the Concordium wallet's dApp signing prompt (or the registry dApp's set-metadata flow).");
console.log(`→ after it lands, the head ${head} is recoverable from the badge metadata on-chain.`);
console.log(`integrity check: sha256("${head}") =`, createHash("sha256").update(head).digest("hex"));

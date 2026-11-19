// Usage: node scripts/register-agents.mjs [command] [args]
//   card-hash [base-url]     Fetch /.well-known/agent-card.json and print its SHA-256
//                            (the metadata_hash to anchor on-chain). Default base: PUBLIC_URL in .dev.vars.
//   check-badge <badge>      Call the hosted registry's /v1/badge-check and print the verdict.
//   verify-card <badge>      Call /v1/verify-agent-card (on-chain hash vs hosted card).
//   steps                    Print the registration checklist.
// Reads PUBLIC_URL, CCD_REGISTRY_API, CCD_REGISTRY_NETWORK from .dev.vars.
// The on-chain registration itself happens in the Agent Registry dApp (wallet signature
// required) — see docs/CONCORDIUM.md. This script produces the values it asks for.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const registry = vars.CCD_REGISTRY_API || "https://agent-registry-mcp.concordium.com";
const network = vars.CCD_REGISTRY_NETWORK || "testnet";
const base = (process.argv[3] || vars.PUBLIC_URL || "").replace(/\/$/, "");

const [cmd, arg] = [process.argv[2], process.argv[3]];

if (cmd === "card-hash") {
  const url = `${base}/.well-known/agent-card.json`;
  if (!base) fail("no base URL — pass it as an arg or set PUBLIC_URL in .dev.vars");
  const body = await (await fetch(url)).text();
  console.log(JSON.stringify({ url, sha256: createHash("sha256").update(body, "utf8").digest("hex") }, null, 2));
} else if (cmd === "check-badge" || cmd === "verify-card") {
  const badge = arg || process.argv[4];
  if (!badge) fail(`usage: ${cmd} <base-url?> <badge>`);
  const path = cmd === "check-badge" ? "badge-check" : "verify-agent-card";
  const res = await fetch(`${registry}/v1/${path}/${encodeURIComponent(badge)}?network=${network}`);
  console.log(JSON.stringify({ status: res.status, ...(await res.json()) }, null, 2));
} else if (cmd === "steps") {
  console.log(`Agent fleet registration (docs/CONCORDIUM.md):
1. node scripts/register-agents.mjs card-hash   → the card's SHA-256 (metadata_hash)
2. Registry dApp https://agent-registry-mcp.concordium.com (network=${network}):
   register the agent with agent_uri = <base>/.well-known/agent-card.json and that hash.
3. Note the token id + token address (the badge). Put in .dev.vars / wrangler secrets:
   SNAPFLIP_AGENT_BADGE, AGENT_TOKEN_ID, AGENT_OWNER_ACCOUNT, REGISTRY_CONTRACT
4. Redeploy, re-run card-hash, and confirm the hash is unchanged — badge metadata
   must not shift the served bytes. Then: check-badge <badge>, verify-card <badge>.
5. Flip REQUIRE_AGENT_BADGE=1 to turn the join gate on.`);
} else {
  fail("commands: card-hash [base-url] | check-badge <badge> | verify-card <badge> | steps");
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

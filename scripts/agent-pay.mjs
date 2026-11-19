// Owner: E. Demo paying agent — the "winner's agent pays on its own" beat. Calls an
// x402-gated endpoint, handles the 402 handshake, pays, prints the CCDExplorer link.
//   CCD_PAYER_ADDRESS=<acct> CCD_PAYER_PRIVATE_KEY=<key> \
//   node scripts/agent-pay.mjs settle <auctionId> [--url http://localhost:8787]
//   node scripts/agent-pay.mjs market "pokemon yellow" [--url ...]
import { ExactConcordiumScheme } from "@x402/concordium/exact/client";
import { CONCORDIUM_TESTNET_CAIP2, CONCORDIUM_TESTNET_EXPLORER } from "@x402/concordium";
import { AccountAddress, buildBasicAccountSigner } from "@concordium/web-sdk";

const [cmd, ...rest] = process.argv.slice(2);
const baseUrl = flag("--url") ?? process.env.PUBLIC_URL ?? "http://localhost:8787";
const network = process.env.CCD_NETWORK || CONCORDIUM_TESTNET_CAIP2;

function flag(name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

const address = process.env.CCD_PAYER_ADDRESS;
const privateKey = process.env.CCD_PAYER_PRIVATE_KEY;
if (!cmd || !address || !privateKey) {
  console.log(`usage:
  CCD_PAYER_ADDRESS=<acct> CCD_PAYER_PRIVATE_KEY=<key> node scripts/agent-pay.mjs <cmd> [args] [--url <base>]

commands:
  settle <auctionId>   pay the clearing price on a won auction (POST /api/agent/auctions/:id/settle)
  market <query>       pay for a market lookup (GET /api/agent/market?q=...)`);
  process.exit(cmd ? 0 : 1);
}

const signer = {
  accountAddress: AccountAddress.fromBase58(address),
  signer: buildBasicAccountSigner(privateKey),
};
const scheme = new ExactConcordiumScheme(signer);

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

/** One full x402 round-trip against a gated route. */
async function paidFetch(path, init = {}) {
  const first = await fetch(baseUrl + path, init);
  if (first.status !== 402) return first;

  const requiredHeader = first.headers.get("payment-required") ?? first.headers.get("x-payment-required");
  if (!requiredHeader) throw new Error("402 without PAYMENT-REQUIRED header");
  const required = unb64(requiredHeader);
  const accepts = required.accepts ?? [];
  const requirements = accepts.find((a) => a.scheme === "exact" && a.network === network) ?? accepts[0];
  if (!requirements) throw new Error("no acceptable payment requirements: " + JSON.stringify(required));

  console.log(`402 → paying ${requirements.amount ?? JSON.stringify(requirements.price)} ${requirements.asset ?? ""} to ${requirements.payTo}`);
  const { x402Version, payload } = await scheme.createPaymentPayload(required.x402Version ?? 2, requirements);
  const paymentPayload = { x402Version, scheme: "exact", network, payload };
  const paymentHeader = b64(JSON.stringify(paymentPayload));

  const second = await fetch(baseUrl + path, {
    ...init,
    headers: { ...init.headers, "x-payment": paymentHeader, "payment-signature": paymentHeader },
  });
  const respHeader = second.headers.get("payment-response");
  if (respHeader) {
    const settle = unb64(respHeader);
    if (settle.transaction) console.log(`settled tx: ${settle.transaction}\n  ${CONCORDIUM_TESTNET_EXPLORER}/transaction/${settle.transaction}`);
  }
  return second;
}

if (cmd === "settle") {
  const id = rest[0];
  if (!id) throw new Error("settle needs an auction id");
  const r = await paidFetch(`/api/agent/auctions/${id}/settle`, { method: "POST" });
  console.log(r.status, await r.text());
} else if (cmd === "market") {
  const q = rest.join(" ");
  const r = await paidFetch(`/api/agent/market?q=${encodeURIComponent(q)}`);
  console.log(r.status, (await r.text()).slice(0, 2000));
} else {
  throw new Error("unknown command " + cmd);
}

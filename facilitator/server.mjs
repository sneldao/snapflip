// Owner: E. Standalone x402 facilitator for Concordium — the missing link until a hosted
// one (Boostabs) is confirmed. Sponsors gas for every payment it settles: agents pay in
// a PLT and never hold CCD. Run:
//   CCD_FACILITATOR_ADDRESS=<account> CCD_FACILITATOR_PRIVATE_KEY=<key> node facilitator/server.mjs
// then set X402_FACILITATOR_URL=http://localhost:4021 on the Worker.
import { createServer } from "node:http";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactConcordiumScheme } from "@x402/concordium/exact/facilitator";
import {
  CONCORDIUM_TESTNET_CAIP2,
  getConcordiumGrpcUrl,
  parseGrpcUrl,
  toConcordiumFacilitatorSigner,
} from "@x402/concordium";

const network = process.env.CCD_NETWORK || CONCORDIUM_TESTNET_CAIP2;
const address = process.env.CCD_FACILITATOR_ADDRESS;
const privateKey = process.env.CCD_FACILITATOR_PRIVATE_KEY;
if (!address || !privateKey) {
  console.error("need CCD_FACILITATOR_ADDRESS + CCD_FACILITATOR_PRIVATE_KEY (sponsor account, faucet-funded on testnet)");
  process.exit(1);
}

const [host, port] = parseGrpcUrl(getConcordiumGrpcUrl(network));
const signer = toConcordiumFacilitatorSigner(address, privateKey, { host, port, useTls: true });
const scheme = new ExactConcordiumScheme({
  signer,
  requireFinalization: true,
});
const facilitator = new x402Facilitator().register(network, scheme);

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/supported") {
      return json(res, 200, facilitator.getSupported());
    }
    if (req.method === "POST" && req.url === "/verify") {
      const { paymentPayload, paymentRequirements } = await readBody(req);
      return json(res, 200, await facilitator.verify(paymentPayload, paymentRequirements));
    }
    if (req.method === "POST" && req.url === "/settle") {
      const { paymentPayload, paymentRequirements } = await readBody(req);
      return json(res, 200, await facilitator.settle(paymentPayload, paymentRequirements));
    }
    if (req.method === "GET" && req.url === "/healthz") {
      return json(res, 200, { ok: true, network, sponsor: address });
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error(req.method, req.url, e);
    json(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(Number(process.env.PORT) || 4021, () => {
  console.log(`x402 facilitator on :${process.env.PORT || 4021} — network ${network}, sponsor ${address}`);
});

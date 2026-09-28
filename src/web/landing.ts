// Owner: D. Landing page, booth QR display, and live real-numbers stats.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import QRCode from "qrcode";
import { layout } from "./layout";
import type { App } from "../lib/util";

export const landing = new Hono<App>();

/** Live stats for the public pages. Excludes seeded b_demo_* buyers: the demo needs real numbers only. */
landing.get("/api/stats", async (c) => {
  const { results: skus } = await c.env.DB.prepare(
    `SELECT s.id AS sku_id, s.title, s.platform, COUNT(DISTINCT o.id) AS orders, COUNT(DISTINCT o.buyer_id) AS collectors, SUM(o.max_cents) AS demand_cents
       FROM orders o JOIN order_skus os ON os.order_id = o.id JOIN skus s ON s.id = os.sku_id
      WHERE o.status = 'open' AND o.buyer_id NOT LIKE 'b_demo_%' GROUP BY s.id ORDER BY demand_cents DESC`,
  ).all();
  const totals = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT buyer_id) AS collectors, COALESCE(SUM(max_cents), 0) AS demand_cents FROM orders WHERE status = 'open' AND buyer_id NOT LIKE 'b_demo_%'",
  ).first<{ collectors: number; demand_cents: number }>();
  const tx = await c.env.DB.prepare(
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(a.clearing_cents), 0) AS transacted_cents
       FROM auctions a LEFT JOIN orders o ON o.id = a.winner_order_id
      WHERE a.status IN ('captured', 'released') AND a.payment_intent_id NOT LIKE 'pi_stub_%'
        AND COALESCE(o.buyer_id, '') NOT LIKE 'b_demo_%'`,
  ).first<{ transactions: number; transacted_cents: number }>();
  return c.json({
    collectors: totals?.collectors ?? 0,
    demandCents: totals?.demand_cents ?? 0,
    skus,
    transactions: tx?.transactions ?? 0,
    transactedCents: tx?.transacted_cents ?? 0,
  });
});

const statsScript = html`<script>
  async function refresh() {
    const r = await fetch("/api/stats");
    const ob = await r.json();
    document.getElementById("demand").textContent = "$" + Math.round(ob.demandCents / 100).toLocaleString();
    document.getElementById("collectors").textContent = ob.collectors;
    const tx = document.getElementById("tx");
    if (tx) tx.textContent = ob.transactions;
    const ul = document.getElementById("skus");
    if (ul) ul.replaceChildren(...ob.skus.slice(0, 8).map((s) => {
      const li = document.createElement("li");
      li.textContent = s.title + " (" + s.platform + "): " + s.collectors + " collectors";
      return li;
    }));
  }
  refresh();
  setInterval(refresh, 5000);
</script>`;

landing.get("/", async (c) => {
  const buyUrl = `${c.env.PUBLIC_URL}/buy`;
  const qr = await QRCode.toString(buyUrl, { type: "svg", margin: 1 });
  return c.html(
    layout(
      "SnapFlip: sold before you buy it",
      html`<h1>Sold before you buy it.</h1>
        <p class="muted">Buyer agents bid on thrift finds while they're still on the rack.</p>
        <div class="card row">
          <div><div class="big" id="demand">$0</div><div class="muted">standing demand</div></div>
          <div><div class="big" id="collectors">0</div><div class="muted">collectors</div></div>
          <div><div class="big" id="tx">0</div><div class="muted">real transactions</div></div>
        </div>
        <p><a class="button" href="/buy">Set a standing order</a></p>
        <div class="card row">
          <div class="qrbox">${raw(qr)}</div>
          <div>
            <strong>Most wanted</strong>
            <ul id="skus"></ul>
            <p class="muted">Point your phone at the code or go to ${buyUrl}</p>
          </div>
        </div>
        ${statsScript}`,
    ),
  );
});

// Booth display: huge QR + headline + live numbers, readable from ~2m.
landing.get("/qr", async (c) => {
  const buyUrl = `${c.env.PUBLIC_URL}/buy`;
  const qr = await QRCode.toString(buyUrl, { type: "svg", margin: 2 });
  return c.html(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SnapFlip booth</title>
    <style>
      body { margin: 0; background: #fff; color: #111; font-family: system-ui, sans-serif;
             min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
      h1 { font-size: 3.5rem; margin: 0 24px 24px; max-width: 900px; }
      .qr svg { width: min(60vh, 60vw); height: auto; }
      .url { font-size: 1.8rem; font-weight: 700; margin-top: 16px; }
      .stats { font-size: 1.5rem; color: #555; margin-top: 12px; }
    </style>
  </head>
  <body>
    <h1>Tell an agent what you're hunting. It bids for you.</h1>
    <div class="qr">${raw(qr)}</div>
    <div class="url">${buyUrl}</div>
    <div class="stats"><span id="demand">$0</span> standing demand &middot; <span id="collectors">0</span> collectors &middot; <span id="tx">0</span> real transactions</div>
    ${statsScript}
  </body>
</html>`);
});

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
  const { results: recent } = await c.env.DB.prepare(
    `SELECT a.status, a.clearing_cents, a.ended_at, s.title
       FROM auctions a
       JOIN snaps sn ON sn.id = a.snap_id
       LEFT JOIN skus s ON s.id = sn.sku_id
       LEFT JOIN orders o ON o.id = a.winner_order_id
      WHERE a.status IN ('settled', 'captured', 'released')
        AND a.payment_intent_id NOT LIKE 'pi_stub_%'
        AND COALESCE(o.buyer_id, '') NOT LIKE 'b_demo_%'
      ORDER BY a.ended_at DESC LIMIT 8`,
  ).all<{ status: string; clearing_cents: number | null; ended_at: string; title: string | null }>();
  return c.json({
    collectors: totals?.collectors ?? 0,
    demandCents: totals?.demand_cents ?? 0,
    skus,
    transactions: tx?.transactions ?? 0,
    transactedCents: tx?.transacted_cents ?? 0,
    recent,
  });
});

/** Scripted demo tape (clearly labeled SIMULATED) — types out a full snap→sold loop so judges
 *  get the product in ~15s with zero interaction. Honest framing: the stats/tape below are real,
 *  this reel is the pitch, not data. */
const DEMO_TAPE: { tag: string; cls: string; txt: string }[] = [
  { tag: "SNAP", cls: "amber", txt: "rack photo — pokemon_yellow.gb, $6 tag" },
  { tag: "CLAUDE", cls: "phos", txt: 'sku gb-pokemon-yellow-us · conf 0.97 · grade B "light label wear" · not a repro' },
  { tag: "DEMAND", cls: "phos", txt: "5 agents holding orders · $122 standing" },
  { tag: "AUCTION", cls: "phos", txt: "60s clock · reserve $10 · +$2/tick" },
  { tag: "$10", cls: "dim", txt: "agents #1 #2 #3 #4 #5 in" },
  { tag: "$20", cls: "dim", txt: "#3 out — cap $18" },
  { tag: "$30", cls: "dim", txt: "#1 out — grade-B cap $25 · #4 out — max $30" },
  { tag: "$38", cls: "dim", txt: "#2 out — label wear · #5 still in" },
  { tag: "SOLD", cls: "phos bold", txt: "agent #5 wins $38 · seller nets $34.20 · card charged on seller confirm" },
  { tag: "LIVE", cls: "amber", txt: "real money · real agents · scan to join" },
];

const tapeScript = html`<script>
  (function () {
    var TAPE = ${raw(JSON.stringify(DEMO_TAPE))};
    var reel = document.getElementById("reel");
    var btn = document.getElementById("replay");
    if (!reel) return;
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var timer = null;
    function line(tag, cls, txt) {
      var d = document.createElement("div");
      d.className = "reel-line";
      var t = document.createElement("span");
      t.className = "reel-tag " + cls;
      t.textContent = tag;
      var s = document.createElement("span");
      d.append(t, s);
      reel.appendChild(d);
      if (reduce) { s.textContent = txt; return 0; }
      var i = 0;
      return (function type() {
        s.textContent = txt.slice(0, ++i) + (i < txt.length ? "█" : "");
        if (i < txt.length) timer = setTimeout(type, 14);
      })(), Math.max(250, txt.length * 14);
    }
    function play() {
      reel.textContent = "";
      var i = 0;
      (function next() {
        if (document.hidden) { timer = setTimeout(next, 500); return; }
        var dur = line(TAPE[i].tag, TAPE[i].cls, TAPE[i].txt);
        if (++i < TAPE.length) { timer = setTimeout(next, dur + 900); }
        else {
          if (btn) btn.hidden = false;
          timer = setTimeout(play, 4000); // hold the SOLD frame, then loop
        }
      })();
    }
    if (btn) btn.addEventListener("click", function () { clearTimeout(timer); btn.hidden = true; play(); });
    play();
  })();
</script>`;

// QR SVGs don't change per request — render once per URL.
const qrCache = new Map<string, Promise<string>>();
const qrSvg = (url: string, margin: number) => {
  const key = `${url}|${margin}`;
  let p = qrCache.get(key);
  if (!p) {
    p = QRCode.toString(url, { type: "svg", margin });
    qrCache.set(key, p);
  }
  return p;
};

const statsScript = html`<script>
  var cur = {};
  function animate(id, to, fmt) {
    var el = document.getElementById(id);
    if (!el) return;
    var from = cur[id] === undefined ? to : cur[id];
    cur[id] = to;
    if (from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    requestAnimationFrame(function step(t) {
      var k = Math.min(1, (t - t0) / 600);
      el.textContent = fmt(Math.round(from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
    });
  }
  var dollars = function (v) { return "$" + v.toLocaleString(); };
  var plain = function (v) { return "" + v; };
  async function refresh() {
    if (document.hidden) return;
    try {
      const r = await fetch("/api/stats");
      if (!r.ok) return;
      const ob = await r.json();
      animate("demand", Math.round(ob.demandCents / 100), dollars);
      animate("collectors", ob.collectors, plain);
      animate("tx", ob.transactions, plain);
      const ul = document.getElementById("skus");
      if (ul) {
        if (!ob.skus.length) {
          const li = document.createElement("li");
          li.textContent = "No orders yet — be the first. Scan the code.";
          ul.replaceChildren(li);
        } else {
          const top = ob.skus.slice(0, 8);
          const peak = Math.max(1, ...top.map((s) => s.demand_cents || 0));
          ul.replaceChildren(...top.map((s) => {
            const li = document.createElement("li");
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = s.title + " (" + s.platform + ")";
            const bar = document.createElement("span");
            bar.className = "bar";
            const fill = document.createElement("i");
            fill.style.width = Math.max(4, Math.round((100 * (s.demand_cents || 0)) / peak)) + "%";
            bar.appendChild(fill);
            const n = document.createElement("span");
            n.className = "n";
            n.textContent = "$" + Math.round((s.demand_cents || 0) / 100).toLocaleString() + " · " + s.collectors + " collectors";
            li.append(t, bar, n);
            return li;
          }));
        }
      }
      const tape = document.getElementById("tape");
      if (tape) {
        if (!ob.recent || !ob.recent.length) {
          const li = document.createElement("li");
          li.textContent = "No auctions yet — snap a cartridge to start one.";
          tape.replaceChildren(li);
        } else {
          tape.replaceChildren(...ob.recent.map((a) => {
            const li = document.createElement("li");
            if (a.status === "captured" || a.status === "released") li.className = "win";
            const hhmm = (a.ended_at || "").slice(11, 16);
            li.textContent = (a.title || "item") + " — sold $" + Math.round((a.clearing_cents || 0) / 100) + (hhmm ? " · " + hhmm + "Z" : "");
            return li;
          }));
        }
      }
    } catch (e) { /* keep last values on a failed poll */ }
  }
  refresh();
  setInterval(refresh, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
</script>`;

landing.get("/", async (c) => {
  const buyUrl = `${c.env.PUBLIC_URL}/buy`;
  const qr = await qrSvg(buyUrl, 1);
  return c.html(
    layout(
      "SnapFlip: sold before you buy it",
      html`<style>
        .eyebrow { font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.28em;
          text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
        .reel { font-family: var(--font-num); font-size: 1.15rem; line-height: 1.7; min-height: 20em;
          padding: 4px 0; white-space: pre-wrap; }
        .reel-line .reel-tag { display: inline-block; width: 5.5em; }
        .reel-tag.phos { color: var(--phos); }
        .reel-tag.amber { color: var(--amber); }
        .reel-tag.dim { color: var(--muted); }
        .reel-line .bold, .reel-tag.bold { font-weight: 700; }
        .reel-line:has(.dim) { color: var(--muted); }
        #replay { background: none; border: 0; color: var(--muted); font-family: var(--font-body);
          font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.15em; cursor: pointer;
          padding: 4px 0; text-shadow: none; }
        #replay:hover { color: var(--phos); box-shadow: none; background: none; }
        .steps { display: flex; gap: 18px; flex-wrap: wrap; }
        .step { flex: 1; min-width: 180px; }
        .step .num { font-family: var(--font-num); font-size: 2rem; color: var(--phos); display: block; }
        .step strong { font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.12em;
          text-transform: uppercase; display: block; margin-bottom: 2px; }
        .foot { margin-top: 28px; font-size: 0.8rem; }
      </style>
      <p class="eyebrow">SnapFlip — agentic resale · live order book</p>
      <h1>Sold before you buy it.</h1>
      <p class="muted">Buyer agents bid on thrift finds while they're still on the rack.</p>
      <div class="card">
        <h2>How a snap becomes a sale <span class="badge" style="float: right">simulated tape</span></h2>
        <div class="reel" id="reel"></div>
        <button id="replay" type="button" hidden>▸ replay</button>
      </div>
      <p><a class="button" href="/buy">Set a standing order</a></p>
      <div class="card">
        <h2>Live right now</h2>
        <div class="row">
          <div><div class="big" id="demand">$0</div><div class="muted">standing demand</div></div>
          <div><div class="big" id="collectors">0</div><div class="muted">collectors</div></div>
          <div><div class="big" id="tx">0</div><div class="muted">real transactions</div></div>
        </div>
      </div>
      <div class="card">
        <h2>Auction tape — real</h2>
        <ul class="feed" id="tape"><li>…</li></ul>
      </div>
      <div class="card">
        <h2>How it works</h2>
        <div class="steps">
          <div class="step"><span class="num">01</span><strong>Set</strong>
            <span class="muted">Name the cart and your max. The spending limit is capped and expires — the agent can never exceed it.</span></div>
          <div class="step"><span class="num">02</span><strong>Snap</strong>
            <span class="muted">A reseller photographs it on Telegram. Claude IDs the SKU and grades it; matching agents enter a 60s clock auction.</span></div>
          <div class="step"><span class="num">03</span><strong>Sold</strong>
            <span class="muted">The seller sees the clearing price before paying. Buy, confirm, card captured; payout on delivery.</span></div>
        </div>
      </div>
      <div class="card">
        <h2>Market depth</h2>
        <div class="row" style="align-items: flex-start">
          <div class="qrbox">${raw(qr)}</div>
          <div style="flex: 1; min-width: 300px">
            <ul class="depth" id="skus"></ul>
            <p class="muted">Point your phone at the code or go to ${buyUrl}</p>
          </div>
        </div>
      </div>
      <p><a class="button" href="/buy">Set a standing order</a></p>
      <p class="foot muted">built at the startup speedrun — anthropic claude · cloudflare workers/d1/r2/do · stripe connect · brainbase</p>
      ${tapeScript}
      ${statsScript}`,
    ),
  );
});

// Booth display: huge QR + headline + live numbers, readable from ~2m.
landing.get("/qr", async (c) => {
  const buyUrl = `${c.env.PUBLIC_URL}/buy`;
  const qr = await qrSvg(buyUrl, 2);
  return c.html(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#070a08" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23070a08'/%3E%3Ctext x='2' y='12.5' font-family='monospace' font-size='11' font-weight='bold' fill='%2346ff8f'%3ES%3E%3C/text%3E%3C/svg%3E" />
    <title>SnapFlip booth</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Share+Tech+Mono&family=VT323&display=swap" rel="stylesheet" />
    <style>
      body { margin: 0; background: #070a08; color: #d8ecd9; font-family: "Share Tech Mono", ui-monospace, monospace;
             min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
      .mark { font-family: "Orbitron", monospace; font-weight: 800; font-size: 1.1rem; letter-spacing: 0.32em; text-transform: uppercase; color: #46ff8f; text-shadow: 0 0 14px rgba(70, 255, 143, 0.35); margin-bottom: 18px; }
      .mark::before { content: "> "; color: #1e7a46; }
      .mark .cursor { animation: blink 1.15s steps(1) infinite; }
      @keyframes blink { 50% { opacity: 0; } }
      h1 { font-family: "Orbitron", monospace; font-weight: 800; font-size: 3rem; margin: 0 24px 24px; max-width: 900px; color: #d8ecd9; text-shadow: 0 0 24px rgba(70, 255, 143, 0.2); }
      .qr { background: #fff; border-radius: 12px; padding: 16px; line-height: 0; box-shadow: 0 0 40px rgba(70, 255, 143, 0.18); }
      .qr svg { width: min(60vh, 60vw); height: auto; }
      .url { font-family: "Orbitron", monospace; font-weight: 600; font-size: 1.6rem; letter-spacing: 0.08em; margin-top: 16px; color: #46ff8f; text-shadow: 0 0 18px rgba(70, 255, 143, 0.35); }
      .stats { font-family: "VT323", monospace; font-size: 1.9rem; color: #7fa08a; margin-top: 12px; }
      .stats span { color: #46ff8f; }
      @media (prefers-reduced-motion: reduce) { .mark .cursor { animation: none; } }
    </style>
  </head>
  <body>
    <div class="mark">snapflip<span class="cursor">&#9646;</span></div>
    <h1>Tell an agent what you're hunting. It bids for you.</h1>
    <div class="qr">${raw(qr)}</div>
    <div class="url">${buyUrl}</div>
    <div class="stats"><span id="demand">$0</span> standing demand &middot; <span id="collectors">0</span> collectors &middot; <span id="tx">0</span> real transactions</div>
    ${statsScript}
  </body>
</html>`);
});

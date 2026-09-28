// Owner: D. Landing page, booth QR display, and live real-numbers stats.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import QRCode from "qrcode";
import { layout, soonRail } from "./layout";
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
const DEMO_TAPE: { tag: string; cls: string; txt: string; price?: number; out?: number[]; sold?: boolean }[] = [
  { tag: "SNAP", cls: "amber", txt: "rack photo — pokemon_yellow.gb, $6 tag" },
  { tag: "CLAUDE", cls: "phos", txt: 'sku gb-pokemon-yellow-us · conf 0.97 · grade B "light label wear" · not a repro' },
  { tag: "DEMAND", cls: "phos", txt: "5 agents holding orders · $122 standing" },
  { tag: "AUCTION", cls: "phos", txt: "60s clock · reserve $10 · +$2/tick" },
  { tag: "$10", cls: "dim", txt: "agents #1 #2 #3 #4 #5 in", price: 10 },
  { tag: "$20", cls: "dim", txt: "#3 out — cap $18", price: 20, out: [3] },
  { tag: "$30", cls: "dim", txt: "#1 out — grade-B cap $25 · #4 out — max $30", price: 30, out: [1, 4] },
  { tag: "$38", cls: "dim", txt: "#2 out — label wear · #5 still in", price: 38, out: [2] },
  { tag: "SOLD", cls: "phos bold", txt: "agent #5 wins $38 · seller nets $34.20 · card charged on seller confirm", sold: true },
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
    var priceEl = document.getElementById("stage-price");
    var stampEl = document.getElementById("stamp");
    function stageReset() {
      if (priceEl) priceEl.textContent = "—";
      if (stampEl) stampEl.classList.remove("on");
      for (var k = 1; k <= 5; k++) {
        var b = document.getElementById("sb" + k);
        if (b) b.classList.remove("out", "win");
      }
    }
    function stageApply(e) {
      if (e.price !== undefined && priceEl) {
        priceEl.textContent = "$" + e.price;
        if (!reduce) { priceEl.classList.remove("tick"); void priceEl.offsetWidth; priceEl.classList.add("tick"); }
      }
      if (e.out) {
        e.out.forEach(function (n) {
          var b = document.getElementById("sb" + n);
          if (b) b.classList.add("out");
        });
      }
      if (e.sold) {
        var w = document.getElementById("sb5");
        if (w) w.classList.add("win");
        if (stampEl) stampEl.classList.add("on");
      }
    }
    function line(tag, cls, txt) {
      var d = document.createElement("div");
      d.className = "reel-line";
      var t = document.createElement("span");
      t.className = "reel-tag " + cls;
      t.textContent = tag;
      var s = document.createElement("span");
      d.append(t, s);
      reel.appendChild(d);
      var fast = document.body.classList.contains("turbo");
      if (reduce || fast) { s.textContent = txt; return 0; }
      var i = 0;
      return (function type() {
        s.textContent = txt.slice(0, ++i) + (i < txt.length ? "█" : "");
        if (i < txt.length) timer = setTimeout(type, 14);
      })(), Math.max(250, txt.length * 14);
    }
    function play() {
      reel.textContent = "";
      stageReset();
      var i = 0;
      (function next() {
        if (document.hidden) { timer = setTimeout(next, 500); return; }
        stageApply(TAPE[i]);
        var dur = line(TAPE[i].tag, TAPE[i].cls, TAPE[i].txt);
        if (++i < TAPE.length) { timer = setTimeout(next, dur + (document.body.classList.contains("turbo") ? 220 : 900)); }
        else {
          if (btn) btn.hidden = false;
          timer = setTimeout(play, 4000); // hold the SOLD frame, then loop
        }
      })();
    }
    if (btn) btn.addEventListener("click", function () { clearTimeout(timer); btn.hidden = true; play(); });
    // Konami code → turbo mode: instant tape, glow boost, badge. Judges who find it will talk about it.
    var seq = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    var ki = 0;
    document.addEventListener("keydown", function (e) {
      ki = e.key === seq[ki] ? ki + 1 : e.key === seq[0] ? 1 : 0;
      if (ki !== seq.length) return;
      ki = 0;
      document.body.classList.add("turbo");
      if (!document.querySelector(".turbo-badge")) {
        var b = document.createElement("div");
        b.className = "turbo-badge";
        b.textContent = "TURBO MODE ▸▸";
        document.body.appendChild(b);
      }
      clearTimeout(timer);
      play();
    });
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
      const cols = document.getElementById("ob-cols");
      const empt = document.getElementById("ob-empty");
      if (cols && empt) {
        const empty = !(ob.recent && ob.recent.length) && !(ob.skus && ob.skus.length);
        cols.hidden = empty;
        empt.hidden = !empty;
      }
      const dash = function () {
        const li = document.createElement("li");
        li.textContent = "—";
        return li;
      };
      const ul = document.getElementById("skus");
      if (ul) {
        if (!ob.skus.length) {
          ul.replaceChildren(dash());
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
            n.textContent = "$" + Math.round((s.demand_cents || 0) / 100).toLocaleString() + " · " + s.collectors + (s.collectors === 1 ? " collector" : " collectors");
            li.append(t, bar, n);
            return li;
          }));
        }
      }
      const tape = document.getElementById("tape");
      if (tape) {
        if (!ob.recent || !ob.recent.length) {
          tape.replaceChildren(dash());
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
  const tg = c.env.TELEGRAM_BOT_USERNAME;
  return c.html(
    layout(
      "SnapFlip: sold before you buy it",
      html`<style>
        .eyebrow { font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.28em;
          text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
        h1 { font-size: clamp(1.9rem, 6vw, 2.6rem); }
        .cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0 6px; }
        .button.ghost { background: transparent; color: var(--phos); border-color: var(--phos-dim); }
        .button.ghost:hover { background: rgba(70, 255, 143, 0.08); border-color: var(--phos);
          box-shadow: 0 0 16px rgba(70, 255, 143, 0.25); }
        .demo-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 22px; align-items: start; }
        .stage { position: relative; border: 1px dashed var(--line); border-radius: 6px;
          padding: 18px 14px; min-height: 15em; text-align: center; }
        .stage .tag { padding: 2px 14px 4px 30px; margin-bottom: 12px; }
        .tag .tagtxt { color: #1c1a14; text-shadow: none; font-family: var(--font-num); font-size: 1.25rem; }
        #stage-price { font-size: 4.6rem; }
        .stage-bots { display: flex; justify-content: center; gap: 14px; margin-top: 10px; }
        .sb { display: flex; flex-direction: column; align-items: center; gap: 5px; }
        .sb .sn { font-family: var(--font-num); font-size: 0.95rem; color: var(--muted); line-height: 1; }
        .sb.out { opacity: 0.35; filter: grayscale(1); }
        .sb.win .botw { filter: drop-shadow(0 0 9px rgba(70, 255, 143, 0.9)); }
        .sb.win .sn { color: var(--phos); text-shadow: 0 0 8px rgba(70, 255, 143, 0.6); }
        .stamp { position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%) rotate(-12deg);
          font-family: var(--font-display); font-weight: 800; font-size: 1.6rem; letter-spacing: 0.08em;
          color: var(--amber); border: 2px solid var(--amber); border-radius: 4px; padding: 4px 14px;
          background: rgba(7, 10, 8, 0.82); opacity: 0;
          text-shadow: 0 0 12px rgba(255, 176, 0, 0.7); box-shadow: 0 0 16px rgba(255, 176, 0, 0.25); }
        .stamp.on { opacity: 1; animation: stampin 0.35s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
        @keyframes stampin { from { transform: translate(-50%, -50%) rotate(-12deg) scale(2.2); opacity: 0; } }
        .reel { font-family: var(--font-num); font-size: 1.05rem; line-height: 1.7; min-height: 15em;
          padding: 4px 0; white-space: pre-wrap; }
        .reel-line .reel-tag { display: inline-block; width: 6.8em; flex: none; white-space: nowrap; }
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
        .ob-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 14px; }
        .obsub { font-family: var(--font-display); font-size: 0.68rem; font-weight: 600;
          letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
        .rails { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
        .rails .r strong { display: block; font-family: var(--font-display); font-size: 0.78rem;
          letter-spacing: 0.1em; text-transform: uppercase; color: var(--phos); margin-bottom: 2px; }
        .rails .r span { color: var(--muted); font-size: 0.85rem; }
        .vs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
        .vs ul { list-style: none; padding: 0; margin: 6px 0 0; font-size: 0.92rem; }
        .vs li { padding: 3px 0; }
        .vs .old li { color: var(--muted); }
        .vs .old li::before { content: "✕ "; color: var(--red); }
        .vs .new li { color: var(--phos); }
        .vs .new li::before { content: "▸ "; color: var(--phos-dim); }
        .foot { margin-top: 28px; font-size: 0.8rem; }
        .foot .blabel { font-family: var(--font-display); font-size: 0.62rem; font-weight: 600;
          letter-spacing: 0.2em; text-transform: uppercase; color: var(--phos-dim); margin-right: 8px; }
        /* Thrift price tag around the demand figure. */
        .tag { display: inline-block; background: #f0e2a8; border-radius: 4px; padding: 2px 18px 6px 34px;
          transform: rotate(-2deg); position: relative; box-shadow: 2px 3px 0 rgba(0, 0, 0, 0.4); }
        .tag::before { content: ""; position: absolute; left: 11px; top: 50%; margin-top: -6px;
          width: 11px; height: 11px; border-radius: 50%; background: #070a08;
          box-shadow: inset 0 0 0 3px #c8b877; }
        .tag .big { color: #1c1a14; text-shadow: none; font-size: 3.8rem; }
        .turbo-badge { position: fixed; right: 14px; bottom: 12px; z-index: 40; font-family: var(--font-display);
          font-size: 0.8rem; letter-spacing: 0.2em; color: var(--amber); text-shadow: 0 0 12px rgba(255, 176, 0, 0.8);
          animation: pulse 0.9s ease-in-out infinite; }
        body.turbo .reel { text-shadow: 0 0 12px rgba(70, 255, 143, 0.55); }
        @media (max-width: 719px) {
          .demo-cols, .ob-cols, .rails, .vs { grid-template-columns: minmax(0, 1fr); }
        }
        @media (prefers-reduced-motion: reduce) { .turbo-badge, .stamp.on { animation: none; } }
      </style>
      <p class="eyebrow">SnapFlip — agentic resale · live order book</p>
      <h1>Sold before you buy it.</h1>
      <p class="muted">Buyer agents bid on thrift finds while they're still on the rack.</p>
      <div class="cta-row">
        <a class="button" href="/buy">I collect — set a standing order</a>
        ${tg ? html`<a class="button ghost" href="https://t.me/${tg}">I resell — snap on Telegram</a>` : ""}
      </div>
      <div class="card">
        <h2>How a snap becomes a sale <span class="badge" style="float: right">simulated tape</span></h2>
        <div class="demo-cols">
          <div class="stage">
            <div class="tag"><span class="tagtxt">$6 tag</span></div>
            <div class="big" id="stage-price">—</div>
            <div class="stage-bots">
              <div class="sb" id="sb1"><span class="botw"><i class="bot" style="--h: 0deg"></i></span><span class="sn">#1</span></div>
              <div class="sb" id="sb2"><span class="botw"><i class="bot" style="--h: 47deg"></i></span><span class="sn">#2</span></div>
              <div class="sb" id="sb3"><span class="botw"><i class="bot" style="--h: 94deg"></i></span><span class="sn">#3</span></div>
              <div class="sb" id="sb4"><span class="botw"><i class="bot" style="--h: 141deg"></i></span><span class="sn">#4</span></div>
              <div class="sb" id="sb5"><span class="botw"><i class="bot" style="--h: 188deg"></i></span><span class="sn">#5</span></div>
            </div>
            <div class="stamp" id="stamp">SOLD $38</div>
          </div>
          <div>
            <div class="reel" id="reel"></div>
            <button id="replay" type="button" hidden>▸ replay</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>How it works</h2>
        <div class="steps">
          <div class="step"><span class="num">01</span><strong>Set</strong>
            <span class="muted">Tell your agent the cart and your max. It never goes over.</span></div>
          <div class="step"><span class="num">02</span><strong>Snap</strong>
            <span class="muted">A reseller snaps it on Telegram. Claude IDs and grades it.</span></div>
          <div class="step"><span class="num">03</span><strong>Sold</strong>
            <span class="muted">Agents bid on a 60s clock. The seller sees the price before paying.</span></div>
        </div>
      </div>
      <div class="card">
        <h2>Live order book <span class="badge live" style="float: right">REAL</span></h2>
        <div class="row">
          <div><div class="tag"><div class="big" id="demand">$0</div></div><div class="muted">standing demand</div></div>
          <div><div class="big" id="collectors">0</div><div class="muted">collectors</div></div>
          <div><div class="big" id="tx">0</div><div class="muted">real transactions</div></div>
        </div>
        <div class="ob-cols" id="ob-cols">
          <div><div class="obsub">Recent sales</div><ul class="feed" id="tape"><li>…</li></ul></div>
          <div><div class="obsub">Standing demand</div><ul class="depth" id="skus"></ul></div>
        </div>
        <p class="muted" id="ob-empty" hidden>The order book opens at the event — be collector #1.</p>
      </div>
      <div class="card">
        <h2>Agents with a limit, not a blank check</h2>
        <div class="rails">
          <div class="r"><strong>Your max is law</strong>
            <span>Code enforces it. The model can only bid lower, never higher.</span></div>
          <div class="r"><strong>Charged on confirm</strong>
            <span>Your card is authorized at the win and captured only when the seller buys the item.</span></div>
          <div class="r"><strong>Paid on delivery</strong>
            <span>The seller's payout is released after the item arrives.</span></div>
          <div class="r"><strong>Every exit explained</strong>
            <span>Agents say why they drop: grade cap, label wear, max reached.</span></div>
        </div>
      </div>
      <div class="card">
        <h2>Why resellers switch</h2>
        <div class="vs">
          <div>
            <div class="obsub">The old way</div>
            <ul class="old">
              <li>Buy the cart first</li>
              <li>Photograph, list, wait</li>
              <li>~13.6% eBay fee</li>
            </ul>
          </div>
          <div>
            <div class="obsub">SnapFlip</div>
            <ul class="new">
              <li>Know it's sold before you pay</li>
              <li>One snap, 60-second auction</li>
              <li>10% fee, only when it sells</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="row" style="align-items: flex-start">
          <div class="qrbox">${raw(qr)}</div>
          <div style="flex: 1; min-width: 240px">
            <h2 style="margin: 0 0 4px">Scan to set a standing order</h2>
            <p class="muted" style="margin: 4px 0 14px">${buyUrl}</p>
            <a class="button" href="/buy">I collect — set a standing order</a>
          </div>
        </div>
      </div>
      ${soonRail}
      <p class="foot muted"><span class="blabel">Built with</span>Anthropic Claude · Cloudflare Workers, D1, R2, Durable Objects · Stripe Connect · Brainbase<br />Built at the startup speedrun.</p>
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
      .soon { font-family: "VT323", monospace; font-size: 1.4rem; color: #1e7a46; letter-spacing: 0.16em; margin-top: 16px; text-transform: uppercase; }
      .coin { font-family: "VT323", monospace; font-size: 2.2rem; color: #ffb000; margin-top: 20px;
              letter-spacing: 0.12em; text-shadow: 0 0 14px rgba(255, 176, 0, 0.6); animation: blink 1.1s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) { .mark .cursor, .coin { animation: none; } }
    </style>
  </head>
  <body>
    <div class="mark">snapflip<span class="cursor">&#9646;</span></div>
    <h1>Tell an agent what you're hunting. It bids for you.</h1>
    <div class="qr">${raw(qr)}</div>
    <div class="url">${buyUrl}</div>
    <div class="coin">&#9656; INSERT COIN TO CONTINUE &#9666;</div>
    <div class="stats"><span id="demand">$0</span> standing demand &middot; <span id="collectors">0</span> collectors &middot; <span id="tx">0</span> real transactions</div>
    <div class="soon">next on the rack — vinyl &middot; lego &middot; trading cards</div>
    ${statsScript}
  </body>
</html>`);
});

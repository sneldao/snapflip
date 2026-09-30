// Owner: D. Landing page, booth QR display, and live real-numbers stats.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import QRCode from "qrcode";
import { layout, soonRail } from "./layout";
import { OG_PNG_BASE64 } from "./og-image";
import type { App } from "../lib/util";

export const landing = new Hono<App>();

/** Share card: served from the bundle so it works with zero R2 setup. */
let ogBytes: Uint8Array | null = null;
landing.get("/og.png", () => {
  if (!ogBytes) {
    const bin = atob(OG_PNG_BASE64);
    ogBytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  }
  return new Response(ogBytes.buffer as ArrayBuffer, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
});

/** Landing footage with byte-range support: static assets answer Range with a full 200, and
 *  iOS Safari refuses to play video without 206 partial responses. Clips are < 0.5 MB each. */
landing.get("/media/:file", async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL(c.req.path, c.req.url)));
  const range = c.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!res.ok || !range) {
    const h = new Headers(res.headers);
    h.set("accept-ranges", "bytes");
    h.set("cache-control", "public, max-age=86400");
    return new Response(res.body, { status: res.status, headers: h });
  }
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=86400",
    },
  });
});

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
  const { results: catalog } = await c.env.DB.prepare(
    `SELECT title, platform FROM skus ORDER BY title LIMIT 12`,
  ).all<{ title: string; platform: string }>();
  // Protocol revenue from the fee ledger. Missing table (pre-ledger DBs) → zeros, not a 500.
  let revenue = { transactions: 0, grossCents: 0, feesCents: 0 };
  try {
    const rev = await c.env.DB.prepare(
      `SELECT COUNT(*) AS transactions, COALESCE(SUM(pf.clearing_cents), 0) AS gross_cents, COALESCE(SUM(pf.fee_cents), 0) AS fees_cents
         FROM platform_fees pf JOIN auctions a ON a.id = pf.auction_id
         LEFT JOIN orders o ON o.id = a.winner_order_id
        WHERE a.status IN ('captured', 'released') AND a.payment_intent_id NOT LIKE 'pi_stub_%'
          AND COALESCE(o.buyer_id, '') NOT LIKE 'b_demo_%'`,
    ).first<{ transactions: number; gross_cents: number; fees_cents: number }>();
    if (rev) revenue = { transactions: rev.transactions, grossCents: rev.gross_cents, feesCents: rev.fees_cents };
  } catch { /* pre-ledger database: revenue stays zero */ }
  return c.json({
    collectors: totals?.collectors ?? 0,
    demandCents: totals?.demand_cents ?? 0,
    skus,
    transactions: tx?.transactions ?? 0,
    transactedCents: tx?.transacted_cents ?? 0,
    recent,
    catalog,
    revenue,
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
    var paused = false; // IntersectionObserver pauses the tape off-screen
    var looped = false; // auto-loop runs once; further viewings use ▸ replay
    var priceEl = document.getElementById("stage-price");
    var stampEl = document.getElementById("stamp");
    var clockEl = document.getElementById("clock-fill");
    var stageEl = document.querySelector("#demo .stage"); // flea market → checkout footage at SOLD
    var beatsBox = document.getElementById("beats");
    var beatEls = beatsBox ? Array.prototype.slice.call(beatsBox.children) : [];
    function setBeat(b) { beatEls.forEach(function (li, j) { li.classList.toggle("on", j === b); li.classList.toggle("done", j < b); }); }
    function stageReset() {
      if (priceEl) priceEl.textContent = "$6";
      if (stampEl) stampEl.classList.remove("on");
      if (stageEl) stageEl.classList.remove("sold");
      if (beatsBox) beatsBox.classList.add("live");
      setBeat(0);
      if (clockEl) clockEl.style.width = "0%";
      for (var k = 1; k <= 5; k++) {
        var b = document.getElementById("sb" + k);
        if (b) b.classList.remove("out", "win");
      }
    }
    function stageApply(e, idx) {
      if (e.price !== undefined && priceEl) {
        priceEl.textContent = "$" + e.price;
        if (!reduce) { priceEl.classList.remove("tick"); void priceEl.offsetWidth; priceEl.classList.add("tick"); }
      }
      if (clockEl) clockEl.style.width = Math.round((100 * (idx + 1)) / TAPE.length) + "%";
      setBeat(e.sold || idx > 8 ? 2 : idx >= 2 ? 1 : 0); // SNAP+CLAUDE · DEMAND..$38 · SOLD+LIVE
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
        if (stageEl) stageEl.classList.add("sold");
        if (clockEl) clockEl.style.width = "100%";
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
        if (document.hidden || paused) { timer = setTimeout(next, 500); return; }
        stageApply(TAPE[i], i);
        var dur = line(TAPE[i].tag, TAPE[i].cls, TAPE[i].txt);
        if (++i < TAPE.length) { timer = setTimeout(next, dur + (document.body.classList.contains("turbo") ? 220 : 900)); }
        else {
          if (btn) btn.hidden = false;
          if (!looped) { looped = true; timer = setTimeout(play, 6000); } // hold SOLD, loop once, then rest
        }
      })();
    }
    if (btn) btn.addEventListener("click", function () { clearTimeout(timer); btn.hidden = true; looped = false; play(); });
    // Pause off-screen so the tape never shouts over reading.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        paused = !entries[0].isIntersecting;
      }).observe(document.getElementById("demo") || reel); // the log is collapsed; watch the card
    }
    function enableTurbo() {
      document.body.classList.add("turbo");
      if (!document.querySelector(".turbo-badge")) {
        var badge = document.createElement("div");
        badge.className = "turbo-badge";
        badge.textContent = "TURBO MODE ▸▸";
        document.body.appendChild(badge);
      }
    }
    // Booth operators have no keyboard: /?turbo=1 speeds the tape live.
    if (/[?&]turbo=1/.test(location.search)) enableTurbo();
    // Konami code → turbo mode: instant tape, glow boost, badge. Judges who find it will talk about it.
    var seq = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    var ki = 0;
    document.addEventListener("keydown", function (e) {
      ki = e.key === seq[ki] ? ki + 1 : e.key === seq[0] ? 1 : 0;
      if (ki !== seq.length) return;
      ki = 0;
      enableTurbo();
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
  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }
  var dollars = function (v) { return "$" + v.toLocaleString(); };
  var plain = function (v) { return "" + v; };
  async function refresh() {
    if (document.hidden) return;
    try {
      const r = await fetch("/api/stats");
      if (!r.ok) return;
      const ob = await r.json();
      var demand = Math.round(ob.demandCents / 100);
      animate("demand", demand, dollars);
      animate("demand-top", demand, dollars);
      animate("collectors", ob.collectors, plain);
      animate("collectors-top", ob.collectors, plain);
      animate("tx", ob.transactions, plain);
      animate("tx-top", ob.transactions, plain);
      setText("hero-demand", dollars(demand) + " standing · " + ob.collectors + (ob.collectors === 1 ? " collector" : " collectors"));
      var bookLive = demand > 0 || (ob.collectors || 0) > 0 || (ob.transactions || 0) > 0;
      if (!bookLive) setText("hero-demand", "order book opens live — be #1");
      var statsRow = document.getElementById("ob-stats");
      if (statsRow) statsRow.hidden = !bookLive;
      if (ob.revenue) {
        var rev = "$" + Math.round((ob.revenue.feesCents || 0) / 100).toLocaleString();
        var gross = "$" + Math.round((ob.revenue.grossCents || 0) / 100).toLocaleString();
        setText("revenue-line", "Protocol revenue so far: " + rev + " (10% of " + gross + " across " + ob.revenue.transactions + " real sales) — every sale pays for the demo.");
      }
      const dot = document.getElementById("live-dot");
      if (dot) dot.classList.toggle("hot", (ob.collectors || 0) > 0 || (ob.transactions || 0) > 0);
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
      const cat = document.getElementById("catalog-chips");
      if (cat && ob.catalog && ob.catalog.length && !cat.dataset.filled) {
        cat.dataset.filled = "1";
        cat.replaceChildren(...ob.catalog.slice(0, 8).map((s) => {
          const a = document.createElement("a");
          a.className = "chip";
          a.href = "/buy?sku=" + encodeURIComponent(s.title);
          a.textContent = s.title;
          return a;
        }));
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

/** Archival footage backdrop (public domain, Moving Image Archive). The poster paints first; the
 *  clip only loads + plays while its section is on screen (see backdropScript). */
const bd = (name: string, extra = "") => html`<div class="bd ${extra}" aria-hidden="true"><video muted loop playsinline preload="none" poster="/media/${name}.jpg" data-src="/media/${name}.mp4"></video></div>`;

const backdropScript = html`<script>
  (function () {
    var still = matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator.connection && navigator.connection.saveData);
    if (still || !("IntersectionObserver" in window)) return; // posters only
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = en.target;
        if (en.isIntersecting) {
          if (!v.getAttribute("src")) v.src = v.dataset.src;
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else if (!v.paused) v.pause();
      });
    }, { rootMargin: "160px 0px" });
    document.querySelectorAll(".bd video[data-src]").forEach(function (v) { io.observe(v); });
  })();
</script>`;

const tourCamScript = html`<script>
  (function () {
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var route = document.getElementById("tour-route");
    var focal = document.getElementById("tour-focal");
    var scaleG = document.getElementById("pov-scale");
    var panG = document.getElementById("pov-pan");
    var priceEl = document.getElementById("stage-price");
    var clockEl = document.getElementById("clock-fill");
    var stampEl = document.getElementById("stamp");
    var beats = Array.prototype.slice.call(document.querySelectorAll(".tour-beat"));
    // Single tape model: stage facts (price, dropouts, sold) derive from the same
    // DEMO_TAPE the autoplay reel types out, so the two can never drift. Only the
    // camera zoom per beat is tour-specific.
    var TAPE = ${raw(JSON.stringify(DEMO_TAPE))};
    var BEAT_TAPE_IDX = [0, 0, 4, 6, 8, 9];
    var BEAT_ZOOM = [1.5, 2.6, 3.1, 2.7, 2.2, 1.4];
    var states = BEAT_TAPE_IDX.map(function (idx, b) {
      var price = "$6", out = [], sold = false;
      for (var j = 0; j <= Math.min(idx, TAPE.length - 1); j++) {
        if (TAPE[j].price !== undefined) price = "$" + TAPE[j].price;
        if (TAPE[j].out) out = out.concat(TAPE[j].out);
        if (TAPE[j].sold) sold = true;
      }
      return { s: BEAT_ZOOM[b] || 1.5, price: price, clock: Math.round((100 * (idx + 1)) / TAPE.length), out: out, sold: sold };
    });
    var len = 0;
    try { len = route.getTotalLength(); } catch (e) { len = 0; }
    var active = -1;
    function applyStage(i) {
      var st = states[Math.max(0, Math.min(states.length - 1, i))];
      if (!st) return;
      if (priceEl) priceEl.textContent = st.price;
      if (clockEl) clockEl.style.width = st.clock + "%";
      for (var k = 1; k <= 5; k++) {
        var b = document.getElementById("sb" + k);
        if (!b) continue;
        b.classList.toggle("out", st.out.indexOf(k) !== -1);
        b.classList.toggle("win", st.sold && k === 5);
      }
      if (stampEl) stampEl.classList.toggle("on", !!st.sold);
    }
    function camFor(p) {
      // Interpolate zoom across beats; pan follows the route focal point.
      var seg = p * (states.length - 1);
      var i0 = Math.max(0, Math.min(states.length - 2, Math.floor(seg)));
      var f = Math.max(0, Math.min(1, seg - i0));
      var s = states[i0].s + (states[i0 + 1].s - states[i0].s) * f;
      var pt = { x: 500, y: 500 };
      if (len && route && route.getPointAtLength) {
        try { pt = route.getPointAtLength(p * len); } catch (e) { /* static frame */ }
      }
      if (reduce) { s = 1; pt = { x: 500, y: 500 }; }
      if (focal) { focal.setAttribute("cx", pt.x); focal.setAttribute("cy", pt.y); }
      if (panG) panG.setAttribute("transform", "translate(" + (500 - pt.x) + " " + (500 - pt.y) + ")");
      if (scaleG) scaleG.setAttribute("transform", "translate(500 500) scale(" + s.toFixed(3) + ") translate(-500 -500)");
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        var p = Math.max(0, Math.min(1, scrollY / max));
        camFor(p);
      });
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var i = beats.indexOf(en.target);
          if (i !== -1 && i !== active) {
            active = i;
            beats.forEach(function (el, j) { el.classList.toggle("active", j === i); });
            applyStage(i);
          }
        });
      }, { rootMargin: "-42% 0px -42% 0px" });
      beats.forEach(function (el) { io.observe(el); });
    } else if (beats.length) {
      beats[0].classList.add("active");
      applyStage(0);
    }
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    camFor(0);
    applyStage(0);
  })();
</script>`;

landing.get("/", async (c) => {
  const buyUrl = `${c.env.PUBLIC_URL}/buy`;
  const qr = await qrSvg(buyUrl, 1);
  const tg = c.env.TELEGRAM_BOT_USERNAME;
  const tgUrl = tg ? `https://t.me/${tg}` : "/buy";
  if (c.req.query("tour") === "1") {
    return c.html(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#170e05" />
    <meta name="description" content="SnapFlip cinematic tour — follow a $6 thrift find to a $38 sale as you scroll." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="SnapFlip tour: $6 → $38 as you scroll" />
    <meta property="og:description" content="SnapFlip cinematic tour — follow a $6 thrift find to a $38 sale as you scroll." />
    <meta property="og:image" content="${c.env.PUBLIC_URL}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>SnapFlip tour: $6 → $38 as you scroll</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Share+Tech+Mono&family=VT323&display=swap" rel="stylesheet" />
    <style>
      :root { color-scheme: dark; --bg: #170e05; --panel: #211507; --line: #4c3314; --line-hi: #6e4a1c;
        --ink: #f0d6a0; --muted: #ab8750; --phos: #ffb338; --phos-dim: #8a5c10; --amber: #ffb338; --red: #ff5f5f;
        --font-body: "Share Tech Mono", ui-monospace, monospace; --font-display: "Orbitron", ui-monospace, monospace;
        --font-num: "VT323", ui-monospace, monospace; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); }
      .fixed-bg { width: 100vw; height: 100vh; position: fixed; inset: 0; overflow: hidden; background: #000; z-index: 0; }
      .fixed-bg svg { border-radius: 2.5vh; width: 50%; top: 5%; height: 90%; position: absolute; left: 25%;
        background: #170e05; border: 1px solid var(--line); }
      @media (max-aspect-ratio: 1.5) { .fixed-bg svg { left: 9%; width: 82%; } }
      .hud { position: fixed; inset: 0; z-index: 2; pointer-events: none; }
      .hud .frame { position: absolute; inset: 4vh 6vw; border: 1px solid rgba(255,179,56,0.22); border-radius: 12px; }
      .hud .frame::before, .hud .frame::after { content: ""; position: absolute; width: 22px; height: 22px; border: 2px solid var(--phos); }
      .hud .frame::before { top: -2px; left: -2px; border-right: 0; border-bottom: 0; }
      .hud .frame::after { bottom: -2px; right: -2px; border-left: 0; border-top: 0; }
      .hud-top { position: absolute; top: calc(4vh + 12px); left: 0; right: 0; display: flex; justify-content: center; }
      .hud-pill { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display);
        font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted);
        border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; background: rgba(23,14,5,0.8); text-decoration: none; }
      .hud-hint { position: absolute; bottom: calc(4vh + 10px); left: 0; right: 0; text-align: center;
        font-family: var(--font-display); font-size: 0.68rem; letter-spacing: 0.3em; color: var(--muted); text-transform: uppercase;
        animation: pulse 1.8s ease-in-out infinite; }
      .tour-scroll { width: 100vw; position: relative; z-index: 1; }
      .tour-beat { min-height: 100vh; display: flex; align-items: center; padding: 12vh 6vw; }
      .tour-beat:nth-child(even) { justify-content: flex-end; }
      .beat-card { max-width: 430px; width: min(430px, 88vw); background: rgba(33,21,7,0.9); backdrop-filter: blur(6px);
        border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px;
        opacity: 0.35; transform: translateY(14px); transition: opacity 0.5s ease, transform 0.5s ease, border-color 0.5s ease; }
      .tour-beat.active .beat-card { opacity: 1; transform: none; border-color: var(--line-hi); box-shadow: 0 8px 40px rgba(0,0,0,0.5); }
      .beat-card .k { font-family: var(--font-display); font-size: 0.66rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--amber); margin-bottom: 6px; }
      .beat-card h1, .beat-card h2 { font-family: var(--font-display); margin: 0 0 8px; }
      .beat-card h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); color: var(--phos); line-height: 1.05; }
      .beat-card h2 { font-size: 1rem; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
      .beat-card p { margin: 8px 0; font-size: 0.92rem; }
      .beat-card .muted { color: var(--muted); }
      .beat-card .big { font-family: var(--font-num); font-size: 4rem; line-height: 1; color: var(--phos); }
      a.button { display: inline-block; background: var(--phos); color: #2a1703; border: 1px solid var(--phos); border-radius: 4px;
        padding: 11px 18px; font-family: var(--font-display); font-weight: 800; font-size: 0.78rem; letter-spacing: 0.1em;
        text-transform: uppercase; text-decoration: none; margin: 4px 8px 0 0; }
      a.button.ghost { background: transparent; color: var(--amber); border-color: #6a5200; }
      .clock { height: 6px; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; margin: 10px 0 4px; background: rgba(255,179,56,0.06); }
      .clock i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--phos-dim), var(--phos)); transition: width 0.6s ease; }
      .stage-bots { display: flex; gap: 12px; margin-top: 10px; }
      .sb { display: flex; flex-direction: column; align-items: center; gap: 4px; transition: opacity 0.4s; }
      .sb .sn { font-family: var(--font-num); color: var(--muted); }
      .sb.out { opacity: 0.3; filter: grayscale(1); }
      .sb.win .sn { color: var(--phos); }
      .stamp { display: inline-block; margin-top: 12px; font-family: var(--font-display); font-weight: 800; letter-spacing: 0.08em;
        color: var(--amber); border: 2px solid var(--amber); border-radius: 4px; padding: 4px 14px; transform: rotate(-6deg);
        opacity: 0; transition: opacity 0.4s; }
      .stamp.on { opacity: 1; }
      .feed, .depth { list-style: none; padding: 0; margin: 8px 0 0; font-size: 0.88rem; }
      .feed li { padding: 2px 0; border-bottom: 1px dotted rgba(76,51,20,0.5); }
      .depth li { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; }
      .depth .t { flex: 0 0 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .depth .bar { flex: 1; height: 10px; background: rgba(255, 179, 56, 0.08); border: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
      .depth .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--phos-dim), var(--phos)); }
      .depth .n { flex: 0 0 auto; color: var(--muted); font-size: 0.8rem; }
      .botw { width: 24px; height: 26px; flex: 0 0 auto; }
      .bot { display: block; width: 4px; height: 4px; --c: var(--phos); filter: hue-rotate(var(--h, 0deg));
        box-shadow: 8px 0 var(--c), 0 4px var(--c), 4px 4px var(--c), 8px 4px var(--c), 12px 4px var(--c), 16px 4px var(--c),
          0 8px var(--c), 8px 8px var(--c), 16px 8px var(--c),
          0 12px var(--c), 4px 12px var(--c), 8px 12px var(--c), 12px 12px var(--c), 16px 12px var(--c),
          4px 16px var(--c), 8px 16px var(--c), 12px 16px var(--c), 4px 20px var(--c), 12px 20px var(--c); }
      .qrbox { background: #fff; border-radius: 8px; padding: 8px; line-height: 0; display: inline-block; margin-top: 8px; }
      .qrbox svg { width: 120px; height: auto; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      @media (prefers-reduced-motion: reduce) {
        .beat-card { opacity: 1; transform: none; transition: none; }
        .hud-hint { animation: none; } .clock i { transition: none; }
      }
    </style>
  </head>
  <body>
    <div class="fixed-bg" aria-hidden="true">
      <svg id="tour-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Stylized thrift-rack scene the camera tours">
        <g id="pov-scale"><g id="pov-pan">
          <rect x="-600" y="-600" width="2200" height="2200" fill="#170e05" />
          <rect x="-600" y="120" width="2200" height="26" fill="#211507" stroke="#4c3314" />
          <rect x="-600" y="560" width="2200" height="26" fill="#211507" stroke="#4c3314" />
          <rect x="80" y="300" width="120" height="260" rx="8" fill="#241708" stroke="#6e4a1c" />
          <rect x="230" y="270" width="150" height="290" rx="8" fill="#2a230f" stroke="#ffb338" stroke-width="3" />
          <rect x="250" y="300" width="110" height="70" rx="4" fill="#f0e2a8" />
          <text x="305" y="342" text-anchor="middle" font-family="monospace" font-size="34" fill="#1c1a14">$6</text>
          <rect x="250" y="390" width="110" height="130" rx="4" fill="#e8c33a" />
          <text x="305" y="460" text-anchor="middle" font-family="monospace" font-size="26" fill="#1c1a14">PKMN</text>
          <rect x="420" y="310" width="120" height="250" rx="8" fill="#241708" stroke="#6e4a1c" />
          <rect x="580" y="290" width="130" height="270" rx="8" fill="#241708" stroke="#6e4a1c" />
          <rect x="750" y="320" width="110" height="240" rx="8" fill="#241708" stroke="#6e4a1c" />
          <rect x="230" y="640" width="630" height="120" rx="8" fill="none" stroke="#8a5c10" stroke-dasharray="10 8" />
          <text x="545" y="712" text-anchor="middle" font-family="monospace" font-size="36" fill="#ffb338">SOLD $38 · nets $34.20</text>
          <g class="motion-paths" fill="none" stroke="#ffb338" stroke-opacity="0.35" stroke-dasharray="8 10" stroke-width="3">
            <path d="M196 434c66-49 230 44 322 18" />
            <path d="M518 452c22-1 228 65 303 56" />
            <path d="M821 508s-81 263-18 399" />
            <path d="M803 907s-238-64-317-47" />
            <path d="M486 860s-160 76-298 17" />
          </g>
          <path id="tour-route" d="M196 434 C262 385 426 478 518 452 C540 451 746 517 821 508 C821 508 740 771 803 907 C803 907 565 843 486 860 C486 860 326 936 188 877" fill="none" stroke="none" />
          <circle id="tour-focal" class="focal-point" cx="196" cy="434" r="10" fill="#ffb338" fill-opacity="0.9" />
        </g></g>
      </svg>
    </div>
    <div class="hud">
      <div class="frame"></div>
      <div class="hud-top"><a class="hud-pill" href="/">snapflip ▸ <span id="hero-demand">$0 standing · 0 collectors</span> · scroll ↓</a></div>
      <div class="hud-hint">scroll to fly the rack</div>
    </div>
    <main class="tour-scroll">
      <section class="tour-beat" id="t1"><div class="beat-card">
        <div class="k">◉ live demo — scroll to fly the rack</div>
        <h1>Know it's sold before you pay.</h1>
        <p>Collectors park a max. Resellers snap the rack. Agents bid 60s. <span class="muted">Scroll — the camera flies the route.</span></p>
        <p><a class="button" href="/buy">I collect</a><a class="button ghost" href="${tgUrl}">I resell</a></p>
      </div></section>
      <section class="tour-beat" id="t2"><div class="beat-card">
        <div class="k">01 · Snap — $6 tag</div>
        <h2>Rack photo, 10 seconds</h2>
        <p>One photo at the rack. No listing, no fee, no hauling duds home.</p>
      </div></section>
      <section class="tour-beat" id="t3"><div class="beat-card">
        <div class="k">02 · AI IDs + grades</div>
        <h2>gb-pokemon-yellow-us · conf 0.97</h2>
        <p>Grade B “light label wear” · not a repro. Repros are hard-rejected.</p>
        <div class="big" id="stage-price">$6</div>
        <div class="clock"><i id="clock-fill"></i></div>
      </div></section>
      <section class="tour-beat" id="t4"><div class="beat-card">
        <div class="k">03 · 60s clock auction</div>
        <h2>Agents drop with reasons</h2>
        <p class="muted">#3 out — cap $18 · #1 out — grade-B cap $25 · #4 out — max $30 · #2 out — label wear.</p>
        <div class="stage-bots">
          <div class="sb" id="sb1"><span class="botw"><i class="bot" style="--h: 0deg"></i></span><span class="sn">#1</span></div>
          <div class="sb" id="sb2"><span class="botw"><i class="bot" style="--h: 47deg"></i></span><span class="sn">#2</span></div>
          <div class="sb" id="sb3"><span class="botw"><i class="bot" style="--h: 94deg"></i></span><span class="sn">#3</span></div>
          <div class="sb" id="sb4"><span class="botw"><i class="bot" style="--h: 141deg"></i></span><span class="sn">#4</span></div>
          <div class="sb" id="sb5"><span class="botw"><i class="bot" style="--h: 188deg"></i></span><span class="sn">#5</span></div>
        </div>
      </div></section>
      <section class="tour-beat" id="t5"><div class="beat-card">
        <div class="k">04 · Sold $38</div>
        <h2>Seller nets $34.20 after 10%</h2>
        <p>Buyer pays clearing, never max. Card captured only on seller confirm. <span class="muted">eBay would net ~$32.87 at typical 13.5%.</span></p>
        <p class="muted" id="revenue-line" style="font-size:0.8rem">Protocol revenue so far: $0 — every sale adds 10%.</p>
        <span class="stamp" id="stamp">SOLD $38</span>
      </div></section>
      <section class="tour-beat" id="t6"><div class="beat-card">
        <div class="k">Live order book · real</div>
        <h2><span id="demand">$0</span> standing · <span id="collectors">0</span> collectors · <span id="tx">0</span> sales</h2>
        <ul class="feed" id="tape"><li>…</li></ul>
        <ul class="depth" id="skus"></ul>
        <div id="ob-cols"></div><div id="ob-empty" hidden></div>
        <div class="qrbox">${raw(qr)}</div>
        <p><a class="button" href="/buy">Be collector #1</a><a class="button ghost" href="/">Classic page</a></p>
        <div style="display:none"><span id="demand-top">$0</span><span id="collectors-top">0</span><span id="tx-top">0</span><span id="catalog-chips"></span></div>
      </div></section>
    </main>
    ${tourCamScript}
    ${statsScript}
  </body>
</html>`);
  }
  return c.html(
    layout(
      "SnapFlip: sold before you buy it",
      html`<style>
        .topbar { position: sticky; top: 0; z-index: 30; margin: -14px -20px 14px; padding: 10px 20px;
          background: rgba(231, 221, 198, 0.9); backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .topbar .live-pill { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display);
          font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted);
          border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; }
        .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-hi); display: inline-block; }
        .live-dot.hot { background: var(--red); box-shadow: 0 0 10px rgba(192,57,31,0.8); animation: pulse 1.6s ease-in-out infinite; }
        .topbar .spacer { flex: 1; }
        .topnav { display: flex; gap: 12px; align-items: center; font-size: 0.72rem; }
        .topnav a { color: var(--muted); text-decoration: none; letter-spacing: 0.12em; text-transform: uppercase; font-family: var(--font-display); }
        .topnav a:hover { color: var(--accent); }
        .topbar .mini-cta { padding: 8px 14px; font-size: 0.72rem; }
        .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 0.68rem;
          letter-spacing: 0.28em; text-transform: uppercase; color: var(--amber); margin: 6px 0 8px;
          border: 1px solid var(--amber); border-radius: 999px; padding: 5px 12px; background: rgba(255,179,56,0.08);
          text-shadow: 0 1px 8px rgba(23,14,5,0.7); }
        h1 { font-size: clamp(2.2rem, 7vw, 3.2rem); line-height: 1.02; margin: 8px 0 10px; }
        h1 .glow { color: var(--phos); }
        .lede { font-size: 1.02rem; color: var(--ink); max-width: 34em; margin: 0 0 4px; }
        .lede .muted { color: var(--muted); }
        .proof-strip { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0 4px; }
        .proof { flex: 1; min-width: 150px; border: 1px solid #0a0502; border-radius: 8px; padding: 10px 12px;
          background: radial-gradient(ellipse at 50% 20%, var(--crt2) 0%, var(--crt) 80%);
          box-shadow: inset 0 0 22px rgba(0,0,0,0.5); }
        .proof b { display: block; font-family: var(--font-num); font-size: 1.7rem; font-weight: 400; color: var(--phos); line-height: 1; }
        .proof.amber b { color: var(--amber); }
        .proof span { font-size: 0.78rem; color: #ab8750; }
        .cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0 6px; }
        .button { position: relative; }
        .button.ghost { background: transparent; color: var(--accent); border-color: var(--accent); box-shadow: none; }
        .button.ghost:hover { background: rgba(168,68,28,0.1); }
        .card .button.ghost:hover, .hero .button.ghost:hover { background: rgba(255,179,56,0.12); }
        .cta-note { font-size: 0.8rem; color: var(--muted); margin: 6px 0 0; }
        .park-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; margin-top: 10px; }
        .park-row input[name="sku"] { flex: 2 1 200px; width: auto; }
        .park-row input[name="max"] { flex: 0 1 110px; width: auto; min-width: 90px; }
        .park-row button { flex: 0 0 auto; }
        /* Archival footage backdrops (the promo film's look): footage stays visible; a scrim sits only where text does. */
        .has-bd { position: relative; overflow: hidden; isolation: isolate; }
        .has-bd > .bd { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
        .bd video { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(1.15) contrast(1.05); transform: scale(1.04); }
        .bd::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(23,14,5,0.30), rgba(23,14,5,0.62)); }
        /* The hero is the big tube at the top of the desk: bezel ring + scanlines over the footage. */
        .hero { margin: 4px 0 20px; padding: 72px 24px 30px; min-height: min(78vh, 640px); display: flex; flex-direction: column; justify-content: flex-end;
          align-items: flex-start; border-radius: 12px; border: 1px solid #0a0502;
          box-shadow: 0 0 0 6px var(--chassis), 0 0 0 7px var(--line-hi), 0 12px 26px rgba(58, 42, 16, 0.32); }
        .hero::after { content: ""; position: absolute; inset: 0; border-radius: 11px; z-index: 0; pointer-events: none;
          background: repeating-linear-gradient(0deg, rgba(0,0,0,0.13) 0 1px, transparent 1px 3px); }
        .hero > *:not(.bd) { position: relative; z-index: 1; }
        .hero > .bd::after { background: linear-gradient(90deg, rgba(23,14,5,0.88) 0%, rgba(23,14,5,0.62) 48%, rgba(23,14,5,0.18) 100%),
          linear-gradient(0deg, rgba(23,14,5,0.85) 0%, rgba(23,14,5,0) 55%); }
        .hero h1 { color: #f6ead0; }
        .hero .lede { color: #ecdfc2; }
        .hero .cta-note { color: #bda87e; }
        .hero .cta-note strong { color: #f0d6a0; }
        .hero h1, .hero .lede, .hero .cta-note { text-shadow: 0 2px 14px rgba(0,0,0,0.85); max-width: 32em; }
        .hero a:not(.button) { color: var(--phos); }
        .hero .park-row { max-width: 620px; width: 100%; }
        .card.has-bd, .stage.has-bd { background: #150d05; }
        #trust > .bd::after, #doors > .bd::after { background: linear-gradient(90deg, rgba(23,14,5,0.86) 0%, rgba(23,14,5,0.55) 60%, rgba(23,14,5,0.25) 100%); }
        .stage > .bd::after { background: radial-gradient(ellipse at 50% 50%, rgba(23,14,5,0.62) 0%, rgba(23,14,5,0.25) 70%); }
        .stage .big, .stage .clock-label, .stage .sn { text-shadow: 0 2px 10px rgba(0,0,0,0.9); }
        .stage .sold-bd { opacity: 0; transition: opacity 0.5s ease; }
        .stage.sold .sold-bd { opacity: 1; }
        .stage.sold .sold-bd video { filter: saturate(1.3) brightness(1.12); }
        /* Demo in three beats (snap · bid · sold); the raw agent log is one click away. */
        .beats-col { display: flex; flex-direction: column; justify-content: center; align-self: stretch; }
        .beats { list-style: none; margin: 0; padding: 0; counter-reset: beat; display: grid; gap: 14px; }
        .beats li { counter-increment: beat; border-left: 2px solid var(--line); padding: 4px 0 4px 14px; transition: opacity 0.3s, border-color 0.3s; }
        .beats.live li { opacity: 0.4; }
        .beats.live li.done { opacity: 0.75; }
        .beats.live li.on { opacity: 1; border-color: var(--phos); }
        .beats li b { display: block; font-family: var(--font-display); font-size: 0.82rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); margin-bottom: 2px; }
        .beats li b::before { content: "0" counter(beat) "  "; color: var(--muted); }
        .beats li.on b { color: var(--phos); }
        .beats li span { color: var(--muted); font-size: 0.92rem; }
        .beats li em { font-style: normal; font-family: var(--font-num); font-size: 1.15rem; color: var(--phos); }
        .demo-more { display: flex; gap: 8px 26px; flex-wrap: wrap; margin-top: 14px; }
        .demo-more details { flex: 1 1 260px; }
        .demo-more .reel { min-height: 0; margin-top: 8px; font-size: 0.95rem; }
        /* Lighter tiers: evidence + reassurance without card chrome. */
        .band { margin: 38px 0; }
        .sec-label { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }
        .band-bd { margin: 38px -20px; padding: 34px 20px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        #trust .sec-label { color: #d9c9a4; text-shadow: 0 1px 8px rgba(0,0,0,0.8); }
        #trust .rails .r { border: 0; border-left: 2px solid var(--phos-dim); border-radius: 0; background: transparent; padding: 2px 0 2px 12px; text-shadow: 0 2px 10px rgba(0,0,0,0.9); }
        #trust .rails .r span { color: #ecdfc2; opacity: 0.85; }
        details.more summary { cursor: pointer; font-size: 0.78rem; color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; font-family: var(--font-display); }
        details.more p { font-size: 0.84rem; margin: 8px 0 0; }
        .doors-h { font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; margin: 0; color: #f6ead0; text-shadow: 0 2px 12px rgba(0,0,0,0.85); }
        @media (max-width: 719px) {
          .hero { min-height: 70vh; padding-top: 56px; }
          .hero > .bd::after { background: linear-gradient(0deg, rgba(23,14,5,0.92) 0%, rgba(23,14,5,0.55) 60%, rgba(23,14,5,0.3) 100%); }
        }
        .has-bd .qrbox, .card .qrbox { position: relative; z-index: 3; }
        .funnel { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0 0; }
        .funnel .cell { border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; }
        .funnel .cell.sell { border-color: #6a5200; background: rgba(255,179,56,0.04); }
        .funnel .cell.buy { border-color: var(--line-hi); background: rgba(255,179,56,0.04); }
        .funnel .k { font-family: var(--font-display); font-size: 0.66rem; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 4px; }
        .funnel .buy .k { color: var(--phos); }
        .funnel .sell .k { color: var(--amber); }
        .funnel p { margin: 0; font-size: 0.88rem; }
        .demo-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 22px; align-items: start; clear: both; }
        .stage { position: relative; border: 1px dashed var(--line); border-radius: 6px;
          padding: 18px 14px 14px; min-height: 17em; text-align: center; background: rgba(0,0,0,0.25); }
        .stage .tag { padding: 2px 14px 4px 30px; margin-bottom: 8px; }
        .tag .tagtxt { color: #1c1a14; text-shadow: none; font-family: var(--font-num); font-size: 1.25rem; }
        #stage-price { font-size: 4.6rem; }
        .clock { height: 6px; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; margin: 8px 4px 4px; background: rgba(255,179,56,0.06); }
        .clock i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--phos-dim), var(--phos)); transition: width 0.5s ease; }
        .clock-label { font-size: 0.72rem; color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; font-family: var(--font-display); }
        .stage-bots { display: flex; justify-content: center; gap: 14px; margin-top: 10px; }
        .sb { display: flex; flex-direction: column; align-items: center; gap: 5px; transition: opacity 0.3s; }
        .sb .sn { font-family: var(--font-num); font-size: 0.95rem; color: var(--muted); line-height: 1; }
        .sb.out { opacity: 0.32; filter: grayscale(1); }
        .sb.win .botw { filter: drop-shadow(0 0 9px rgba(255, 179, 56, 0.9)); }
        .sb.win .sn { color: var(--phos); text-shadow: 0 0 8px rgba(255, 179, 56, 0.6); }
        .stamp { position: absolute; top: 36%; left: 50%; transform: translate(-50%, -50%) rotate(-12deg);
          font-family: var(--font-display); font-weight: 800; font-size: 1.6rem; letter-spacing: 0.08em;
          color: var(--amber); border: 2px solid var(--amber); border-radius: 4px; padding: 4px 14px;
          background: rgba(23, 14, 5, 0.88); opacity: 0; pointer-events: none;
          text-shadow: 0 0 12px rgba(255, 179, 56, 0.7); box-shadow: 0 0 16px rgba(255, 179, 56, 0.25); }
        .stamp.on { opacity: 1; animation: stampin 0.35s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
        @keyframes stampin { from { transform: translate(-50%, -50%) rotate(-12deg) scale(2.2); opacity: 0; } }
        .reel { font-family: var(--font-num); font-size: 1.05rem; line-height: 1.7; min-height: 17em;
          padding: 4px 0; white-space: pre-wrap; }
        .reel-line { display: flex; gap: 8px; align-items: baseline; }
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
        .money { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 12px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
        .money .m { padding: 12px 10px; text-align: center; background: rgba(0,0,0,0.2); position: relative; }
        .money .m + .m::before { content: "▸"; position: absolute; left: -7px; top: 38%; color: var(--phos-dim); background: var(--bg); padding: 0 2px; }
        .money .m b { display: block; font-family: var(--font-num); font-size: 1.9rem; font-weight: 400; line-height: 1; }
        .money .m.buy b { color: var(--phos); }
        .money .m.sell b { color: var(--amber); }
        .money .m span { font-size: 0.74rem; color: var(--muted); }
        .steps { display: flex; gap: 18px; flex-wrap: wrap; }
        .step { flex: 1; min-width: 180px; border-left: 2px solid var(--line); padding-left: 12px; }
        .step:first-child { border-color: var(--phos-dim); }
        .step .num { font-family: var(--font-num); font-size: 2rem; color: var(--phos); display: block; line-height: 1; }
        .step strong { font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.12em;
          text-transform: uppercase; display: block; margin: 4px 0 2px; }
        .ob-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 14px; }
        .obsub { font-family: var(--font-display); font-size: 0.68rem; font-weight: 600;
          letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
        .rails { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
        .rails .r { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
        .rails .r strong { display: block; font-family: var(--font-display); font-size: 0.76rem;
          letter-spacing: 0.1em; text-transform: uppercase; color: var(--phos); margin-bottom: 2px; }
        .rails .r span { color: var(--muted); font-size: 0.85rem; }
        .vs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
        .vs ul { list-style: none; padding: 0; margin: 6px 0 0; font-size: 0.92rem; }
        .vs li { padding: 3px 0; }
        .vs .old li { color: var(--muted); }
        .vs .old li::before { content: "✕ "; color: var(--red); }
        .vs .new li { color: var(--phos); }
        .vs .new li::before { content: "▸ "; color: var(--phos-dim); }
        .faq details { border-top: 1px solid var(--line); padding: 10px 2px; }
        .faq details:last-child { border-bottom: 1px solid var(--line); }
        .faq summary { cursor: pointer; font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.06em; color: var(--ink); }
        .faq p { color: var(--muted); font-size: 0.88rem; margin: 6px 0 2px; }
        .foot { margin-top: 28px; font-size: 0.8rem; }
        .foot .blabel { font-family: var(--font-display); font-size: 0.62rem; font-weight: 600;
          letter-spacing: 0.2em; text-transform: uppercase; color: var(--phos-dim); margin-right: 8px; }
        .tag { display: inline-block; background: #f0e2a8; border-radius: 4px; padding: 2px 18px 6px 34px;
          transform: rotate(-2deg); position: relative; box-shadow: 2px 3px 0 rgba(0, 0, 0, 0.4); }
        .tag::before { content: ""; position: absolute; left: 11px; top: 50%; margin-top: -6px;
          width: 11px; height: 11px; border-radius: 50%; background: #170e05;
          box-shadow: inset 0 0 0 3px #c8b877; }
        .tag .big { color: #1c1a14; text-shadow: none; font-size: 3.8rem; }
        .turbo-badge { position: fixed; right: 14px; bottom: 12px; z-index: 40; font-family: var(--font-display);
          font-size: 0.8rem; letter-spacing: 0.2em; color: var(--amber); text-shadow: 0 0 12px rgba(255, 179, 56, 0.8);
          animation: pulse 0.9s ease-in-out infinite; }
        body.turbo .reel { text-shadow: 0 0 12px rgba(255, 179, 56, 0.55); }
        @media (max-width: 719px) {
          .demo-cols, .ob-cols, .rails, .vs, .funnel { grid-template-columns: minmax(0, 1fr); }
          .money { grid-template-columns: 1fr 1fr; }
          .money .m:nth-child(3)::before { content: none; }
          .topbar { margin: -14px -20px 12px; }
          .topnav { display: none; }
          .qrbox { display: none; }
        }
        @media (prefers-reduced-motion: reduce) { .turbo-badge, .stamp.on { animation: none; } .clock i { transition: none; } }
      </style>
      <div class="topbar">
        <span class="live-pill"><i class="live-dot" id="live-dot"></i> <span id="hero-demand">order book opens live — be #1</span></span>
        <span class="spacer"></span>
        <a class="button ghost mini-cta" href="/sell">I resell</a>
        <a class="button primary mini-cta" href="/buy">Set order</a>
      </div>
      <section class="hero has-bd">
        ${bd("storefront")}
        <p class="eyebrow">◉ Live · real money · real agents</p>
        <h1>Tell an agent what you're hunting. <span class="glow">It wins it for you.</span></h1>
        <p class="lede">Set your max once. When a reseller snaps a match at a thrift store, your agent bids in a 60-second auction — and never goes a dollar over.</p>
        <form method="get" action="/buy" class="park-row">
          <input name="sku" list="sku-list" maxlength="120" placeholder="What are you hunting? Describe it your way" autocomplete="off" aria-label="Item you want" />
          <datalist id="sku-list"></datalist>
          <input name="max" type="number" min="1" max="1000" step="1" placeholder="Max $" aria-label="Max price in USD" />
          <button type="submit" class="primary">Start hunting →</button>
        </form>
        <p class="cta-note">Type anything — off-catalog hunts get logged as demand. Charged only if your agent wins.<br />
          Prefer the desk? Text <strong>+1 650 315 6536</strong> · Resellers snap via Telegram — <a href="${tgUrl}">@snapflipbot</a></p>
      </section>
      <script>
        (function () {
          var dl = document.getElementById("sku-list");
          if (!dl || dl.dataset.filled) return;
          fetch("/api/stats").then(function (r) { return r.json(); }).then(function (ob) {
            if (!ob.catalog) return;
            dl.dataset.filled = "1";
            ob.catalog.slice(0, 12).forEach(function (s) {
              var o = document.createElement("option");
              o.value = s.title;
              dl.appendChild(o);
            });
          }).catch(function () { /* free-text still works */ });
        })();
      </script>
      <div class="card" id="demo">
        <h2>How a snap becomes a sale <span class="badge" style="float: right">simulated · 15s</span></h2>
        <div class="demo-cols">
          <div class="stage has-bd">
            ${bd("flea-market")}${bd("checkout", "sold-bd")}
            <div class="tag"><span class="tagtxt">$6 tag</span></div>
            <div class="big" id="stage-price">$6</div>
            <div class="clock"><i id="clock-fill"></i></div>
            <div class="clock-label">60s clock · +$2 / tick</div>
            <div class="stage-bots">
              <div class="sb" id="sb1"><span class="botw"><i class="bot" style="--h: 0deg"></i></span><span class="sn">#1</span></div>
              <div class="sb" id="sb2"><span class="botw"><i class="bot" style="--h: 47deg"></i></span><span class="sn">#2</span></div>
              <div class="sb" id="sb3"><span class="botw"><i class="bot" style="--h: 94deg"></i></span><span class="sn">#3</span></div>
              <div class="sb" id="sb4"><span class="botw"><i class="bot" style="--h: 141deg"></i></span><span class="sn">#4</span></div>
              <div class="sb" id="sb5"><span class="botw"><i class="bot" style="--h: 188deg"></i></span><span class="sn">#5</span></div>
            </div>
            <div class="stamp" id="stamp">SOLD $38</div>
          </div>
          <div class="beats-col">
            <ol class="beats" id="beats">
              <li><b>Snap</b><span>A reseller photographs a <em>$6</em> cart. AI IDs it: Pokémon Yellow, grade B, not a repro.</span></li>
              <li><b>Bid</b><span>5 buyer agents bid on a 60-second clock. Each drops out at its own cap — and says why.</span></li>
              <li><b>Sold</b><span>Cleared at <em>$38</em>. The seller nets <em>$34.20</em> before paying for the cart. No sale? They walk away.</span></li>
            </ol>
            <button id="replay" type="button" hidden>↻ replay</button>
          </div>
        </div>
        <div class="demo-more">
        <details class="more"><summary>Agent log</summary><div class="reel" id="reel"></div></details>
        <details class="more"><summary>Where the money goes</summary>
          <p class="muted">The buyer's card is authorized at the win and captured only when the seller buys the item and sends an in-hand photo. SnapFlip keeps 10%; the seller's payout releases on delivery via Stripe Connect. On a $38 sale eBay would net ~$32.87 (typical 13–15% all-in).</p>
          <p class="muted" id="revenue-line">Protocol revenue so far: $0 — every sale adds 10%.</p>
        </details>
        </div>
      </div>
      <section class="band" id="book">
        <p class="sec-label">Live order book <span class="badge live">real</span></p>
        <div class="device">
          <div class="screen">
            <div class="row" id="ob-stats" hidden>
              <div><div class="tag"><div class="big" id="demand">$0</div></div><div class="muted">standing demand</div></div>
              <div><div class="big" id="collectors">0</div><div class="muted">collectors</div></div>
              <div><div class="big" id="tx">0</div><div class="muted">sales</div></div>
            </div>
            <div class="ob-cols" id="ob-cols">
              <div><div class="obsub">Recent sales</div><ul class="feed" id="tape"><li>…</li></ul></div>
              <div><div class="obsub">Standing demand</div><ul class="depth" id="skus"></ul></div>
            </div>
            <div id="ob-empty" hidden>
              <p class="muted" style="margin:4px 0 10px">The book opens live at the event. Early collectors set the price — every reseller then hunts for you.</p>
            </div>
          </div>
        </div>
        <div class="obsub" style="margin-top:14px">Agents can hunt today</div>
        <div class="chips" id="catalog-chips"></div>
      </section>
      <section class="band" id="scout">
        <p class="sec-label">Text the desk <span class="badge live">live</span></p>
        <p style="margin:0"><strong>Scout is our first hire</strong> — an agent on the collector desk, reachable like a person. Text it what you're hunting; it reads this book, advises a max, and hands you a prefilled order. Or text it the thing you lost as a kid — it prices the buy-back off real market data, appraises your whole childhood box on a till receipt, and sets a watch that pings you on Telegram when the price dips.</p>
        <p style="margin:14px 0 0; display:flex; align-items:center; gap:16px; flex-wrap:wrap">
          <a class="button primary" href="sms:+16503156536">✆ Text Scout</a>
          <a class="tag" href="sms:+16503156536" style="text-decoration:none"><span class="tagtxt">+1 650 315 6536</span></a>
        </p>
        <p class="muted" style="margin:12px 0 0">Not ready to order? Play it: text "guess the price" and it deals a real cleared auction — pawnbroker rules, you call it, it shows the tape. Two of you arguing over a fair price? Pull it into the thread and it'll flip a coin for it.</p>
      </section>
      <section class="band band-bd has-bd" id="trust">
        ${bd("cash-count")}
        <p class="sec-label">Autonomy with guardrails</p>
        <div class="rails">
          <div class="r"><strong>▣ Your max is law</strong>
            <span>Enforced in code, not the prompt. The model can only bid lower.</span></div>
          <div class="r"><strong>◉ Charged on proof</strong>
            <span>Captured only after the seller sends an in-hand photo — and vision checks it's the same item that sold.</span></div>
          <div class="r"><strong>⌗ Paid on delivery</strong>
            <span>The seller's payout releases once the item arrives.</span></div>
          <div class="r"><strong>✦ Every exit explained</strong>
            <span>Agents say why they drop: grade cap, label wear, max reached.</span></div>
        </div>
      </section>
      <section class="band faq" id="faq">
        <p class="sec-label">Fair questions</p>
        <details><summary>What if nobody bids?</summary><p>You walk away. No listing, no fee, no dead inventory. The snap cost you 10 seconds.</p></details>
        <details><summary>When is my card actually charged?</summary><p>Only after the seller buys the item and sends an in-hand photo — which vision checks against the original snap before a cent moves. Before that it's an authorization hold at the clearing price — never your max.</p></details>
        <details><summary>What stops fakes?</summary><p>AI vision checks every snap for repro tells, and the auction engine hard-rejects anything flagged. Grade caps let buyers skip rough copies.</p></details>
        <details><summary>Do I need Telegram or Claude?</summary><p>Resellers use Telegram. Collectors can use the web, text Scout (+1 650 315 6536), Claude (MCP connector) or the Brainbase concierge — same order book.</p></details>
        <details><summary>What does it cost?</summary><p>Collecting is free. Sellers pay 10% only when it sells. Optional Buyer Plus ($6/mo) wins tie-breaks.</p></details>
      </section>
      <div class="card has-bd" id="doors">
        ${bd("shelves")}
        <div class="row" style="align-items: center">
          <div class="qrbox">${raw(qr)}</div>
          <div style="flex: 1; min-width: 240px">
            <p class="doors-h">Two doors, one book.</p>
            <div class="cta-row" style="margin-top:10px">
              <a class="button primary" href="/buy">I collect — start hunting</a>
              <a class="button ghost" href="/sell">I resell — how it pays</a>
            </div>
          </div>
        </div>
      </div>
      <div style="display:none"><span id="demand-top">$0</span><span id="collectors-top">0</span><span id="tx-top">0</span></div>
      ${soonRail}
      <p class="foot muted"><span class="blabel">Talk to us</span>Text the desk: <a href="sms:+16503156536">+1 650 315 6536</a> · Resellers: <a href="${tgUrl}">@snapflipbot</a> on Telegram<br />
        <span class="blabel">Built with</span>Anthropic Claude · Featherless · Cloudflare Workers, D1, R2, Durable Objects · Stripe Connect · Brainbase<br />Built at Startup Speedrun · <a href="/?tour=1">take the scroll tour</a> · Archival footage: Moving Image Archive (public domain).</p>
      ${tapeScript}
      ${statsScript}
      ${backdropScript}`,
      { image: `${c.env.PUBLIC_URL}/og.png` },
    ),
  );
});

// Reseller onboarding: what happens after the snap, before the Telegram bounce.
landing.get("/sell", (c) => {
  const tg = c.env.TELEGRAM_BOT_USERNAME;
  const tgUrl = tg ? `https://t.me/${tg}` : "/buy";
  return c.html(
    layout(
      "SnapFlip for resellers: sold before you buy it",
      html`<style>
        .eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 0.68rem;
          letter-spacing: 0.28em; text-transform: uppercase; color: var(--accent); margin: 6px 0 8px;
          border: 1px solid var(--accent); border-radius: 999px; padding: 5px 12px; background: rgba(168,68,28,0.06); }
        h1 { font-size: clamp(2rem, 6vw, 2.8rem); line-height: 1.05; }
        h1 .glow { color: var(--accent); }
        .button.ghost { background: transparent; color: var(--accent); border-color: var(--accent); box-shadow: none; }
        .button.ghost:hover { background: rgba(168,68,28,0.08); }
        .card .button.ghost { color: var(--amber); border-color: var(--amber); }
        .card .button.ghost:hover { background: rgba(255,179,56,0.1); }
        .steps { display: flex; gap: 18px; flex-wrap: wrap; }
        .step { flex: 1; min-width: 180px; border-left: 2px solid #6a5200; padding-left: 12px; }
        .step .num { font-family: var(--font-num); font-size: 2rem; color: var(--amber); display: block; line-height: 1; }
        .step strong { font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.12em;
          text-transform: uppercase; display: block; margin: 4px 0 2px; }
      </style>
      <p class="eyebrow">◉ For resellers · 60 seconds · $0 risk</p>
      <h1>Know it's <span class="glow">sold</span> before you pay.</h1>
      <p class="muted">One photo at the rack. Agents bid while you watch. Buy the item only if it clears your reserve — walk away free if it doesn't.</p>
      <div class="card">
        <h2>At the rack</h2>
        <div class="steps">
          <div class="step"><span class="num">01</span><strong>Snap — 10s</strong>
            <span class="muted">Send one photo to the bot. AI vision IDs the exact item, grades it, and shows its work — confidence, the evidence it saw, marked on your photo.</span></div>
          <div class="step"><span class="num">02</span><strong>Watch — 60s</strong>
            <span class="muted">Collector agents bid on a live clock, right in the chat. You see every tick.</span></div>
          <div class="step"><span class="num">03</span><strong>Decide</strong>
            <span class="muted">Cleared? Grab it, tap “I bought it”, ship it. Not cleared? Leave it — no fee, no listing, nothing lost.</span></div>
        </div>
      </div>
      <div class="card">
        <h2>The money</h2>
        <p style="margin:0">10% fee, <strong>only when it sells</strong>. A $38 clearing puts <strong>$34.20</strong> in your pocket (eBay would net ~$32.87 at typical 13.5%). Payout lands on delivery via Stripe — trusted sellers can express-cash-out at confirm for a 1% rush.</p>
      </div>
      <div class="card">
        <h2>What you need</h2>
        <ul class="muted" style="margin:0">
          <li>Telegram — the whole auction happens in chat.</li>
          <li>One Stripe onboarding (2 min) before your first payout.</li>
          <li>That's it. No listings, no photoshoots, no fee to try.</li>
        </ul>
        <p style="margin:14px 0 0"><a class="button ghost" href="${tgUrl}">▸ Open the bot and snap it</a></p>
      </div>
      <p class="muted"><a href="/">← Back to the full pitch</a></p>
      <p class="muted" style="margin-top:20px; font-size:0.8rem"><span style="font-family: var(--font-display); font-size: 0.62rem; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-right: 8px">Talk to us</span>Snap here on Telegram · Collectors text the desk: <a href="sms:+16503156536">+1 650 315 6536</a></p>`,
      { image: `${c.env.PUBLIC_URL}/og.png` },
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
    <meta name="theme-color" content="#170e05" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23170e05'/%3E%3Ctext x='2' y='12.5' font-family='monospace' font-size='11' font-weight='bold' fill='%23ffb338'%3ES%3E%3C/text%3E%3C/svg%3E" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="SnapFlip booth" />
    <meta property="og:image" content="${c.env.PUBLIC_URL}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>SnapFlip booth</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Share+Tech+Mono&family=VT323&display=swap" rel="stylesheet" />
    <style>
      body { margin: 0; background: #170e05; color: #f0d6a0; font-family: "Share Tech Mono", ui-monospace, monospace;
             min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
      .mark { font-family: "Orbitron", monospace; font-weight: 800; font-size: 1.1rem; letter-spacing: 0.32em; text-transform: uppercase; color: #ffb338; text-shadow: 0 0 14px rgba(255, 179, 56, 0.35); margin-bottom: 18px; }
      .mark::before { content: "> "; color: #8a5c10; }
      .mark .cursor { animation: blink 1.15s steps(1) infinite; }
      @keyframes blink { 50% { opacity: 0; } }
      h1 { font-family: "Orbitron", monospace; font-weight: 800; font-size: 3rem; margin: 0 24px 24px; max-width: 900px; color: #f0d6a0; text-shadow: 0 0 24px rgba(255, 179, 56, 0.2); }
      .qr { background: #fff; border-radius: 12px; padding: 16px; line-height: 0; box-shadow: 0 0 40px rgba(255, 179, 56, 0.18); }
      .qr svg { width: min(60vh, 60vw); height: auto; }
      .url { font-family: "Orbitron", monospace; font-weight: 600; font-size: 1.6rem; letter-spacing: 0.08em; margin-top: 16px; color: #ffb338; text-shadow: 0 0 18px rgba(255, 179, 56, 0.35); }
      .stats { font-family: "VT323", monospace; font-size: 1.9rem; color: #ab8750; margin-top: 12px; }
      .stats span { color: #ffb338; }
      .soon { font-family: "VT323", monospace; font-size: 1.4rem; color: #8a5c10; letter-spacing: 0.16em; margin-top: 16px; text-transform: uppercase; }
      .coin { font-family: "VT323", monospace; font-size: 2.2rem; color: #ffb338; margin-top: 20px;
              letter-spacing: 0.12em; text-shadow: 0 0 14px rgba(255, 179, 56, 0.6); animation: blink 1.1s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) { .mark .cursor, .coin { animation: none; } }
    </style>
  </head>
  <body>
    <div class="mark">snapflip<span class="cursor">&#9646;</span></div>
    <h1>Tell an agent what you're hunting. It bids for you.</h1>
    <div class="qr">${raw(qr)}</div>
    <div class="url">${buyUrl}</div>
    <div class="stats">or text the desk — <span>+1 650 315 6536</span></div>
    <div class="coin">&#9656; INSERT COIN TO CONTINUE &#9666;</div>
    <div class="stats"><span id="demand">$0</span> standing demand &middot; <span id="collectors">0</span> collectors &middot; <span id="tx">0</span> real transactions</div>
    <div class="soon">next on the rack — vinyl &middot; lego &middot; trading cards</div>
    ${statsScript}
  </body>
</html>`);
});

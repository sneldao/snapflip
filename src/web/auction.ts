// Owner: A. Live auction page: subscribes to /a/{id}/ws and renders the ticker and dropouts.
// The money shot: polaroid snap, shutter flash, pixel-bot agents, boss-bar clock, GOING ONCE.
import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "./layout";
import type { App } from "../lib/util";

export const auctionPage = new Hono<App>();

auctionPage.get("/a/:id", async (c) => {
  // The appraisal slab — the work the agent did, printed like a grading label.
  const appraisal = await c.env.DB.prepare(
    `SELECT sn.id AS snap_id, sn.grade, sn.grade_notes, sn.flags_json, sn.findings_json, sn.confidence,
            sk.platform
       FROM auctions a JOIN snaps sn ON sn.id = a.snap_id LEFT JOIN skus sk ON sk.id = sn.sku_id
      WHERE a.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<{
      snap_id: string; grade: string | null; grade_notes: string | null;
      flags_json: string; findings_json: string; confidence: number | null; platform: string | null;
    }>();
  const findings: { area: string; observation: string }[] = appraisal?.findings_json
    ? JSON.parse(appraisal.findings_json)
    : [];
  const flags: string[] = appraisal?.flags_json ? JSON.parse(appraisal.flags_json) : [];
  const slab = appraisal?.grade
    ? html`<div class="card">
        <h2>appraisal · cert ${appraisal.snap_id}</h2>
        <div class="slabline">
          <span class="slabgrade slab-${appraisal.grade}">${appraisal.grade}</span>
          <span>
            ${appraisal.platform ? html`<span class="muted">${appraisal.platform} · </span>` : ""}
            ${appraisal.confidence != null ? html`<span class="muted">identified ${Math.round(appraisal.confidence * 100)}%</span>` : ""}
          </span>
        </div>
        ${findings.length
          ? html`<ul class="feed">${findings.map((f) => html`<li>${f.area} — ${f.observation}</li>`)}</ul>`
          : appraisal.grade_notes
            ? html`<p class="muted">${appraisal.grade_notes}</p>`
            : null}
        ${flags.length ? html`<p class="muted">⚑ ${flags.map((f) => f.replace(/_/g, " ")).join(" · ")}</p>` : null}
      </div>`
    : null;

  return c.html(
    layout(
      "SnapFlip: live auction",
      html`<style>
        .polaroid { background: #f4efe0; padding: 10px 10px 34px; transform: rotate(-1.6deg);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55); position: relative; }
        .polaroid::before { content: ""; position: absolute; top: -9px; left: 50%; width: 86px; height: 22px;
          margin-left: -43px; background: rgba(200, 190, 150, 0.55); transform: rotate(-2deg); }
        .polaroid img { width: 100%; display: block; max-height: 300px; object-fit: contain; background: #111; border: 0; margin: 0; }
        .polaroid .cap { color: #3a352a; font-family: var(--font-num); font-size: 1.15rem; margin-top: 8px; text-align: center; }
        #flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 60; }
        #flash.on { animation: snapflash 0.45s ease-out; }
        @keyframes snapflash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
        .hp { height: 18px; border: 1px solid var(--line); border-radius: 3px; position: relative;
          overflow: hidden; background: #1a1008; margin: 10px 0 4px; }
        .hp i { position: absolute; inset: 0 auto 0 0; width: 100%; background: var(--phos);
          transition: width 0.25s linear, background 0.4s; box-shadow: 0 0 14px rgba(255, 179, 56, 0.35); }
        .hp.mid i { background: #d98a0e; }
        .hp.low i { background: var(--red); }
        .hp .seg { position: absolute; inset: 0;
          background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(23, 14, 5, 0.85) calc(10% - 1px) 10%); }
        #call { font-family: var(--font-display); font-weight: 800; font-size: 1.9rem; letter-spacing: 0.14em;
          color: var(--amber); text-shadow: 0 0 20px rgba(255, 179, 56, 0.6); margin: 8px 0 0;
          animation: pulse 0.9s ease-in-out infinite; }
        #verdict { font-family: var(--font-display); font-weight: 800; font-size: 1.6rem; letter-spacing: 0.1em; margin: 10px 0 0; }
        #verdict.win { color: var(--phos); text-shadow: 0 0 22px rgba(255, 179, 56, 0.55); }
        #verdict.drop { color: var(--red); }
        .agents { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
        .chip-a { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 4px;
          padding: 7px 12px 7px 8px; background: rgba(255, 179, 56, 0.05); }
        .chip-a.out { opacity: 0.38; background: transparent; }
        .chip-a.out .nm { text-decoration: line-through; }
        .chip-a .nm { font-family: var(--font-num); font-size: 1.1rem; line-height: 1; }
        .chip-a .why { display: block; color: var(--muted); font-size: 0.72rem; font-family: var(--font-body); }
        /* The appraisal slab: grade reads like a printed grading label. */
        .slabline { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
        .slabgrade { font-family: var(--font-num); font-size: 3rem; line-height: 1; color: var(--phos);
          text-shadow: 0 0 20px rgba(255, 179, 56, 0.5); border: 1px solid var(--phos-dim);
          border-radius: 6px; padding: 2px 14px; }
        .slabgrade.slab-C { color: #e08a2e; border-color: #8a5c10; }
        .slabgrade.slab-D { color: var(--red); border-color: var(--red); }
        .slabline + .feed { margin-top: 4px; }
      </style>
      <div id="flash"></div>
      <p><span class="badge off" id="status">CONNECTING</span></p>
      <h1 id="title">Live auction</h1>
      <div class="row" style="align-items: stretch">
        <div class="card" style="flex: 2 1 340px">
          <h2>Current price</h2>
          <div class="big" id="price">$0</div>
          <div class="hp" id="hp"><i id="hpfill"></i><span class="seg"></span></div>
          <div class="muted"><span id="active">0</span> agents still bidding &middot; <span id="left">60</span>s left</div>
          <div class="muted" id="netline"></div>
          <div id="call" hidden></div>
          <div id="verdict" hidden></div>
        </div>
        <div class="card" style="flex: 1 1 260px">
          <h2>The snap</h2>
          <div class="polaroid">
            <img src=${`/a/${c.req.param("id")}/photo`} alt="Photo of the item up for auction" onload="document.getElementById('nophoto').hidden = true" onerror="this.closest('.polaroid').remove();document.getElementById('nophoto').hidden = false" />
            <div class="cap" id="cap">the snap</div>
          </div>
          <p class="muted" id="nophoto" hidden>Item photo unavailable.</p>
        </div>
      </div>
      ${slab}
      <div class="card">
        <h2>Agents in the hunt</h2>
        <div class="agents" id="agents"></div>
      </div>
      <div class="card">
        <h2>Auction tape</h2>
        <ul class="feed" id="feed"></ul>
      </div>
      <script>
        var $ = function (id) { return document.getElementById(id); };
        var usd = function (c) { return "$" + (c / 100).toFixed(0); };
        var endsAt = 0, startAt = null, span = 60000, lastPrice = -1, closeCount = 0, wasClosing = false, flashed = false;
        var seen = new Set();
        var order = new Map(); // orderId → join index, keeps chip order stable
        function feed(text, cls) {
          var li = document.createElement("li");
          li.textContent = text;
          if (cls) li.className = cls;
          $("feed").prepend(li);
        }
        function badge(status) {
          var el = $("status");
          if (status === "live") { el.className = "badge live"; el.textContent = "LIVE"; }
          else if (status === "cleared") { el.className = "badge sold"; el.textContent = "SOLD"; }
          else if (status === "no_sale") { el.className = "badge nosale"; el.textContent = "NO SALE"; }
          else { el.className = "badge off"; el.textContent = "DISCONNECTED"; }
        }
        function flash() {
          var f = $("flash");
          f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
        }
        function chipFor(a) {
          var ch = document.createElement("div");
          ch.className = "chip-a";
          var w = document.createElement("span");
          w.className = "botw";
          var bot = document.createElement("i");
          bot.className = "bot";
          bot.style.setProperty("--h", (order.get(a.orderId) * 47) % 360 + "deg");
          w.appendChild(bot);
          var txt = document.createElement("span");
          var nm = document.createElement("span");
          nm.className = "nm";
          nm.textContent = a.label;
          var why = document.createElement("span");
          why.className = "why";
          txt.append(nm, why);
          ch.append(w, txt);
          return ch;
        }
        function renderAgents(v) {
          var all = v.active.concat(v.dropped);
          for (var i = 0; i < all.length; i++) {
            if (!order.has(all[i].orderId)) order.set(all[i].orderId, order.size);
          }
          var box = $("agents");
          box.textContent = "";
          all.sort(function (a, b) { return order.get(a.orderId) - order.get(b.orderId); })
            .forEach(function (a) {
              var ch = chipFor(a);
              var dropped = a.atCents !== undefined;
              if (dropped) {
                ch.classList.add("out");
                ch.lastChild.lastChild.textContent = "out @" + usd(a.atCents) + " — " + a.reason;
              } else {
                ch.lastChild.lastChild.textContent = "in — hunting";
              }
              box.appendChild(ch);
            });
        }
        function render(v) {
          endsAt = v.endsAt;
          if (startAt === null) startAt = endsAt - 60000; // auction is a 60s clock
          span = Math.max(span, endsAt - startAt); // soft-close extensions widen the bar
          if (!flashed && v.status === "live") { flashed = true; flash(); }
          $("title").textContent = v.title;
          $("cap").textContent = v.title + " · the snap";
          if (v.priceCents !== lastPrice) {
            lastPrice = v.priceCents;
            var p = $("price");
            p.textContent = usd(v.priceCents);
            p.classList.remove("tick"); void p.offsetWidth; p.classList.add("tick");
          }
          $("active").textContent = v.active.length;
          (function () {
            var bps = v.feeBps || 1000;
            var fee = Math.round((v.priceCents * bps) / 10000);
            $("netline").textContent = "Seller nets " + usd(v.priceCents - fee) +
              " after " + (bps / 100) + "% SnapFlip fee" + (v.winner ? " · final" : " · live");
          })();
          badge(v.status);
          var call = $("call");
          if (v.closing && !wasClosing) {
            closeCount++;
            call.textContent = ["GOING ONCE", "GOING TWICE", "FINAL CALL"][Math.min(2, closeCount - 1)];
          }
          wasClosing = !!v.closing;
          call.hidden = !v.closing;
          renderAgents(v);
          for (var i = 0; i < v.active.length; i++) {
            var a = v.active[i];
            if (!seen.has("j" + a.orderId)) { seen.add("j" + a.orderId); feed(a.label + " joined"); }
          }
          for (var j = 0; j < v.dropped.length; j++) {
            var d = v.dropped[j];
            if (!seen.has("d" + d.orderId)) { seen.add("d" + d.orderId); feed(d.label + " dropped at " + usd(d.atCents) + ": " + d.reason, "drop"); }
          }
          var verdict = $("verdict");
          if (v.winner && !seen.has("w")) {
            seen.add("w");
            feed(v.winner.label + " won at " + usd(v.winner.priceCents), "win");
            verdict.textContent = "SOLD " + usd(v.winner.priceCents) + " — " + v.winner.label +
              (v.winner.netCents !== undefined ? " · seller nets " + usd(v.winner.netCents) : "");
            verdict.className = "win"; verdict.hidden = false; flash();
          } else if (v.status === "no_sale" && !seen.has("n")) {
            seen.add("n");
            verdict.textContent = "LEFT ON THE RACK"; verdict.className = "drop"; verdict.hidden = false;
          }
        }
        setInterval(function () {
          var left = Math.max(0, endsAt - Date.now());
          $("left").textContent = Math.ceil(left / 1000);
          var hp = $("hp"), fill = $("hpfill");
          var frac = span > 0 ? Math.min(1, Math.max(0, left / span)) : 0;
          fill.style.width = (frac * 100) + "%";
          hp.className = "hp" + (frac < 0.18 ? " low" : frac < 0.4 ? " mid" : "");
        }, 250);
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        var retries = 0;
        function connect() {
          var ws = new WebSocket(proto + "//" + location.host + location.pathname + "/ws");
          ws.onmessage = function (e) { retries = 0; render(JSON.parse(e.data)); };
          ws.onclose = function () {
            var st = $("status").textContent;
            if (st !== "LIVE" && st !== "CONNECTING" && st !== "RECONNECTING") return;
            if (++retries > 5) { badge("off"); return; }
            $("status").textContent = "RECONNECTING";
            setTimeout(connect, Math.min(5000, 400 * retries));
          };
        }
        connect();
      </script>`,
      { crt: true, image: `${c.env.PUBLIC_URL}/og.png` },
    ),
  );
});

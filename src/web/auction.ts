// Owner: A. Live auction page: subscribes to /a/{id}/ws and renders the ticker and dropouts.
import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "./layout";
import type { App } from "../lib/util";

export const auctionPage = new Hono<App>();

auctionPage.get("/a/:id", (c) =>
  c.html(
    layout(
      "SnapFlip: live auction",
      html`<p><span class="badge off" id="status">CONNECTING</span></p>
        <h1 id="title">Live auction</h1>
        <div class="row" style="align-items: stretch">
          <div class="card" style="flex: 2 1 340px">
            <h2>Current price</h2>
            <div class="big" id="price">$0</div>
            <div class="muted"><span id="active">0</span> agents still bidding &middot; <span id="left">60</span>s left</div>
          </div>
          <div class="card" style="flex: 1 1 260px">
            <h2>Item</h2>
            <img class="photo" src=${`/a/${c.req.param("id")}/photo`} alt="Photo of the item up for auction" onload="document.getElementById('nophoto').hidden = true" onerror="this.remove()" />
            <p class="muted" id="nophoto" style="margin: 0">Item photo unavailable.</p>
          </div>
        </div>
        <div class="card">
          <h2>Auction tape</h2>
          <ul class="feed" id="feed"></ul>
        </div>
        <script>
          const $ = (id) => document.getElementById(id);
          const usd = (c) => "$" + (c / 100).toFixed(0);
          let endsAt = 0, lastPrice = -1;
          const seen = new Set();
          function feed(text, cls) {
            const li = document.createElement("li");
            li.textContent = text;
            if (cls) li.className = cls;
            $("feed").prepend(li);
          }
          function badge(status) {
            const el = $("status");
            if (status === "live") { el.className = "badge live"; el.textContent = "LIVE"; }
            else if (status === "cleared") { el.className = "badge sold"; el.textContent = "SOLD"; }
            else if (status === "no_sale") { el.className = "badge nosale"; el.textContent = "NO SALE"; }
            else { el.className = "badge off"; el.textContent = "DISCONNECTED"; }
          }
          function render(v) {
            endsAt = v.endsAt;
            $("title").textContent = v.title;
            if (v.priceCents !== lastPrice) {
              lastPrice = v.priceCents;
              const p = $("price");
              p.textContent = usd(v.priceCents);
              p.classList.remove("tick"); void p.offsetWidth; p.classList.add("tick");
            }
            $("active").textContent = v.active.length;
            badge(v.status);
            for (const a of v.active) if (!seen.has("j" + a.orderId)) { seen.add("j" + a.orderId); feed(a.label + " joined"); }
            for (const d of v.dropped) if (!seen.has("d" + d.orderId)) { seen.add("d" + d.orderId); feed(d.label + " dropped at " + usd(d.atCents) + ": " + d.reason, "drop"); }
            if (v.winner && !seen.has("w")) { seen.add("w"); feed(v.winner.label + " won at " + usd(v.winner.priceCents), "win"); }
          }
          setInterval(() => { $("left").textContent = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); }, 250);
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          let retries = 0;
          function connect() {
            const ws = new WebSocket(proto + "//" + location.host + location.pathname + "/ws");
            ws.onmessage = (e) => { retries = 0; render(JSON.parse(e.data)); };
            ws.onclose = () => {
              // Auction over or socket dropped? While live/never-connected, try to come back
              // (the DO sends a full snapshot on connect).
              const st = $("status").textContent;
              if (st !== "LIVE" && st !== "CONNECTING" && st !== "RECONNECTING") return;
              if (++retries > 5) { badge("off"); return; }
              $("status").textContent = "RECONNECTING";
              setTimeout(connect, Math.min(5000, 400 * retries));
            };
          }
          connect();
        </script>`,
      { crt: true },
    ),
  ),
);

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
      html`<p class="muted" id="status">connecting...</p>
        <h1 id="title">Live auction</h1>
        <div class="card">
          <div class="big" id="price">$0</div>
          <div class="muted"><span id="active">0</span> agents still bidding, <span id="left">60</span>s left</div>
        </div>
        <div class="card"><strong>Feed</strong><ul id="feed"></ul></div>
        <script>
          const $ = (id) => document.getElementById(id);
          const usd = (c) => "$" + (c / 100).toFixed(0);
          let endsAt = 0;
          const seen = new Set();
          function feed(text, cls) {
            const li = document.createElement("li");
            li.textContent = text;
            if (cls) li.className = cls;
            $("feed").prepend(li);
          }
          function render(v) {
            endsAt = v.endsAt;
            $("title").textContent = v.title;
            $("price").textContent = usd(v.priceCents);
            $("active").textContent = v.active.length;
            $("status").textContent = v.status === "live" ? "LIVE" : v.status === "cleared" ? "SOLD" : "NO SALE";
            for (const a of v.active) if (!seen.has("j" + a.orderId)) { seen.add("j" + a.orderId); feed(a.label + " joined"); }
            for (const d of v.dropped) if (!seen.has("d" + d.orderId)) { seen.add("d" + d.orderId); feed(d.label + " dropped at " + usd(d.atCents) + ": " + d.reason, "drop"); }
            if (v.winner && !seen.has("w")) { seen.add("w"); feed(v.winner.label + " won at " + usd(v.winner.priceCents), "win"); }
          }
          setInterval(() => { $("left").textContent = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); }, 250);
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          const ws = new WebSocket(proto + "//" + location.host + location.pathname + "/ws");
          ws.onmessage = (e) => render(JSON.parse(e.data));
          ws.onclose = () => { if ($("status").textContent === "LIVE") $("status").textContent = "disconnected, refresh"; };
        </script>`,
    ),
  ),
);

// Owner: D. Landing page with live order book depth.
import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "./layout";
import type { App } from "../lib/util";

export const landing = new Hono<App>();

landing.get("/", (c) =>
  c.html(
    layout(
      "SnapFlip: sold before you buy it",
      html`<h1>Sold before you buy it.</h1>
        <p class="muted">Buyer agents bid on thrift finds while they're still on the rack.</p>
        <div class="card">
          <div class="big" id="demand">$0</div>
          <div class="muted">standing demand across <span id="collectors">0</span> collectors</div>
        </div>
        <p><a class="button" href="/buy">Set a standing order</a></p>
        <div class="card"><strong>Most wanted</strong><ul id="skus"></ul></div>
        <script>
          async function refresh() {
            const r = await fetch("/api/orderbook");
            const ob = await r.json();
            document.getElementById("demand").textContent = "$" + Math.round(ob.demandCents / 100).toLocaleString();
            document.getElementById("collectors").textContent = ob.collectors;
            const ul = document.getElementById("skus");
            ul.replaceChildren(...ob.skus.slice(0, 8).map((s) => {
              const li = document.createElement("li");
              li.textContent = s.title + " (" + s.platform + "): " + s.collectors + " collectors";
              return li;
            }));
          }
          refresh();
          setInterval(refresh, 5000);
        </script>`,
    ),
  ),
);

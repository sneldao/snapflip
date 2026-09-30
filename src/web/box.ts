// Owner: D. "What's my childhood box worth?" — the nostalgic receipt. The desk
// sends collectors here after they list what they lost: every item priced off
// the real market tape, a total at the bottom, and per-item watch/order links.
import { Hono } from "hono";
import { html } from "hono/html";
import { COLLECTION_MAX_ITEMS, collectionPrices } from "../market";
import { usd, type App } from "../lib/util";
import { barcode, layout, receiptStyle } from "./layout";

export const box = new Hono<App>();

const parseItems = (raw: string) =>
  raw
    .split("|")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length >= 2 && s.length <= 140)
    .slice(0, COLLECTION_MAX_ITEMS);

box.get("/box", async (c) => {
  const items = parseItems(c.req.query("items") ?? "");
  if (!items.length) {
    return c.html(
      layout(
        "SnapFlip: the box",
        html`<h1>The box.</h1>
          <p class="err">Nothing to appraise — this link comes with a list. Text the desk (+1 650 315 6536) what you had and it'll build you one.</p>`,
      ),
      400,
    );
  }

  const priced = await collectionPrices(c.env, items);
  const total = priced.reduce((sum, i) => sum + (i.refCents ?? 0), 0);
  const misses = priced.filter((i) => i.refCents == null).length;

  return c.html(
    layout(
      "SnapFlip: what your box is worth",
      html`${receiptStyle}
        <p class="muted" style="font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase">Buy-back appraisal</p>
        <h1>What your box is worth.</h1>
        <div class="receipt">
          <h2>SnapFlip · appraisal</h2>
          <p class="muted" style="margin: 0">${new Date().toISOString().slice(0, 10)} · market tape, cached daily</p>
          ${priced.map(
            (i) => html`<div class="rule">
              <strong>${i.display}</strong>
              ${i.matchedTitle && i.matchedTitle.toLowerCase() !== i.query ? html`<br /><span class="muted" style="font-size: 0.82rem">${i.matchedTitle}</span>` : null}
              <div class="row" style="justify-content: space-between">
                <span>${i.refCents != null ? html`<b>${usd(i.refCents)}</b>${i.cibCents != null ? html` <span class="muted">· in box ${usd(i.cibCents)}</span>` : null}` : html`<span class="muted">no tape on this one</span>`}</span>
                ${i.refCents != null
                  ? html`<a href="/watch?item=${encodeURIComponent(i.display)}&max=${Math.max(1, Math.round(i.refCents! / 100) - 5)}" style="font-size: 0.8rem">watch</a>`
                  : null}
              </div>
            </div>`,
          )}
          <div class="rule" style="border-top: 2px solid #1c1a14">
            <div class="row" style="justify-content: space-between">
              <strong>BOX TOTAL${misses ? ` (${misses} unpriced)` : ""}</strong>
              <b style="font-size: 1.3rem">${usd(total)}</b>
            </div>
          </div>
          ${barcode(items.join("").replace(/\s/g, ""))}
          <p class="thanks">the ones that got away · priced today</p>
        </div>
        <p class="muted">Loose, played-with prices — boxed and sealed copies run higher where the index has them. Want one back? A watch pings you when it dips; a standing order grabs the next one a reseller snaps.</p>
      `,
    ),
  );
});

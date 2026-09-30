// Owner: A. Shared page chrome: cassette-futurism design system for every SnapFlip web page.
// Aesthetic: thrifted appliance — warm cream chassis, amber-phosphor CRT screens (the order
// book is the machine on the desk). Cards are devices: dark screens ringed in beige plastic.
// Fonts: Orbitron (display), VT323 (big numerals), Share Tech Mono (screen), Instrument Sans (prose).
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;
interface LayoutOpts {
  /** CRT mode: scanline + vignette overlay for the live-auction screen. */
  crt?: boolean;
  /** Absolute URL of the share image (og:image / twitter:image). */
  image?: string;
}

export const layout = (title: string, body: Body, opts: LayoutOpts = {}) => html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#e7ddc6" />
    <meta name="description" content="SnapFlip — tell an agent what you're hunting. It bids in live auctions, never above your max." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="SnapFlip — tell an agent what you're hunting. It bids in live auctions, never above your max." />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="SnapFlip — tell an agent what you're hunting. It bids in live auctions, never above your max." />
    ${opts.image
      ? html`<meta property="og:image" content="${opts.image}" />
    <meta name="twitter:image" content="${opts.image}" />`
      : html``}
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23170e05'/%3E%3Ctext x='2' y='12.5' font-family='monospace' font-size='11' font-weight='bold' fill='%23ffb338'%3ES%3E%3C/text%3E%3C/svg%3E" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,600;1,400&family=Orbitron:wght@600;800&family=Share+Tech+Mono&family=VT323&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: light;
        /* Cream desk surface + beige plastic chassis. */
        --bg: #e7ddc6;
        --bg-hi: #ede4d0;
        --chassis: #e2d6b6;
        --chassis-hi: #f2e9d2;
        --chassis-lo: #c9b78f;
        --line: #c4b28a;
        --line-hi: #a18a5d;
        --ink: #33291a;
        --btn-ink: #33291a;
        --muted: #857550;
        --accent: #a8441c;      /* stamp-ink brick — links + "live" on cream */
        /* Amber phosphor, only inside screens/cards. */
        --crt: #170e05;
        --crt2: #221507;
        --phos: #ffb338;
        --phos-dim: #8a5c10;
        --amber: #ffb338;
        --red: #c0391f;
        --font-body: "Instrument Sans", -apple-system, "Segoe UI", sans-serif;
        --font-mono: "Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        --font-display: "Orbitron", "Share Tech Mono", ui-monospace, monospace;
        --font-num: "VT323", "Share Tech Mono", ui-monospace, monospace;
      }
      /* CRT context: every .card/.screen flips descendants to amber-on-dark
         (including mono type) just by redefining the vars. */
      .card, .screen {
        --ink: #f0d6a0;
        --muted: #ab8750;
        --line: #4c3314;
        --line-hi: #6e4a1c;
        --accent: var(--phos);
        --font-body: var(--font-mono);
        color: var(--ink);
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: linear-gradient(180deg, var(--bg-hi), var(--bg)); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.55; }
      main { max-width: 780px; margin: 0 auto; padding: 36px 20px 64px; }
      h1 { font-family: var(--font-display); font-weight: 800; letter-spacing: 0.04em; font-size: 1.9rem; margin: 0 0 10px; color: var(--ink); }
      h2 { font-family: var(--font-display); font-weight: 600; letter-spacing: 0.06em; font-size: 1rem; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
      a { color: var(--accent); }
      .muted { color: var(--muted); }
      .big { font-family: var(--font-num); font-size: 4.4rem; line-height: 1; color: var(--phos); text-shadow: 0 0 24px rgba(255, 179, 56, 0.35); font-variant-numeric: tabular-nums; }
      /* Cards are devices: warm-black CRT ringed by a beige bezel, scanlines on top. */
      .card {
        position: relative; overflow: hidden;
        background: radial-gradient(ellipse at 50% 28%, var(--crt2) 0%, var(--crt) 78%);
        border: 1px solid #0a0502; border-radius: 12px; padding: 16px 18px; margin: 16px 0;
        box-shadow: 0 0 0 6px var(--chassis), 0 0 0 7px var(--line-hi),
          0 12px 26px rgba(58, 42, 16, 0.32), inset 0 0 46px rgba(0, 0, 0, 0.5);
      }
      .card::after {
        content: ""; position: absolute; inset: 0; border-radius: 11px; pointer-events: none; z-index: 2;
        background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.12) 0 1px, transparent 1px 3px);
      }
      /* Bare CRT inset (no bezel) — e.g. the order-book tube inside a .device frame. */
      .screen {
        position: relative; overflow: hidden;
        background: radial-gradient(ellipse at 50% 28%, var(--crt2) 0%, var(--crt) 78%);
        border: 1px solid #0a0502; border-radius: 12px; padding: 16px 18px;
        box-shadow: inset 0 0 46px rgba(0, 0, 0, 0.5);
      }
      .screen::after {
        content: ""; position: absolute; inset: 0; border-radius: 11px; pointer-events: none; z-index: 2;
        background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.12) 0 1px, transparent 1px 3px);
      }
      /* Beige plastic bezel around a bare .screen, with a power LED. */
      .device {
        position: relative;
        background: linear-gradient(180deg, var(--chassis-hi) 0%, var(--chassis) 60%, var(--chassis-lo) 100%);
        border: 1px solid var(--line-hi); border-radius: 18px; padding: 14px;
        box-shadow: 0 10px 24px rgba(58, 42, 16, 0.28), inset 0 1px 0 rgba(255, 250, 230, 0.7);
      }
      .device::before {
        content: ""; position: absolute; right: 12px; bottom: 7px; width: 7px; height: 7px; border-radius: 50%;
        background: var(--phos); box-shadow: 0 0 8px rgba(255, 179, 56, 0.9), inset 0 0 2px rgba(0,0,0,0.4);
      }
      .card > h2:first-child, .card > .bd:first-child + h2, .panel-title {
        display: block; margin: -16px -18px 12px; padding: 6px 12px;
        border-bottom: 1px solid var(--line); border-radius: 11px 11px 0 0;
        background: rgba(255, 179, 56, 0.06); color: var(--muted);
        font-family: var(--font-display); font-weight: 600; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase;
      }
      /* Chunky appliance buttons: raised plastic, presses in on :active. */
      a.button, button {
        display: inline-block; background: linear-gradient(180deg, var(--chassis-hi) 0%, var(--chassis) 55%, var(--chassis-lo) 100%);
        color: var(--btn-ink); border: 1px solid var(--line-hi); border-radius: 8px;
        padding: 11px 20px; font-family: var(--font-display); font-weight: 600; font-size: 0.82rem; letter-spacing: 0.1em; text-transform: uppercase;
        text-decoration: none; cursor: pointer; text-shadow: 0 1px 0 rgba(255, 250, 230, 0.6);
        box-shadow: 0 3px 0 var(--chassis-lo), 0 5px 10px rgba(58, 42, 16, 0.25), inset 0 1px 0 rgba(255, 250, 230, 0.8);
      }
      a.button:hover, button:hover { background: linear-gradient(180deg, #f8f0da 0%, var(--chassis-hi) 60%, var(--chassis) 100%); }
      a.button:active, button:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--chassis-lo), 0 2px 5px rgba(58, 42, 16, 0.25), inset 0 1px 0 rgba(255, 250, 230, 0.8); }
      button.danger { background: linear-gradient(180deg, #d96a52 0%, #b84a30 60%, #9a3a24 100%); color: #fff2ea; border-color: #7c2e1a; text-shadow: 0 1px 0 rgba(90, 20, 5, 0.5); box-shadow: 0 3px 0 #7c2e1a, 0 5px 10px rgba(58, 42, 16, 0.25), inset 0 1px 0 rgba(255, 200, 180, 0.5); }
      /* One primary + one secondary action style on every page. */
      a.button.primary, button.primary { background: linear-gradient(180deg, #ffd073 0%, #f2a01c 60%, #d98a0e 100%); color: #2a1703; border-color: #a86e10; font-weight: 800; text-shadow: 0 1px 0 rgba(255, 224, 160, 0.55); box-shadow: 0 3px 0 #a86e10, 0 5px 12px rgba(58, 42, 16, 0.3), inset 0 1px 0 rgba(255, 235, 180, 0.9); }
      a.button.primary:hover, button.primary:hover { background: linear-gradient(180deg, #ffdd90 0%, #ffb338 60%, #e8990f 100%); box-shadow: 0 3px 0 #a86e10, 0 6px 18px rgba(255, 179, 56, 0.4), inset 0 1px 0 rgba(255, 235, 180, 0.9); }
      a.button.primary:active, button.primary:active { box-shadow: 0 1px 0 #a86e10, 0 2px 6px rgba(58, 42, 16, 0.3), inset 0 1px 0 rgba(255, 235, 180, 0.9); }
      a.button.ghost, button.ghost { background: transparent; color: var(--accent); border-color: var(--accent); box-shadow: none; text-shadow: none; }
      a.button.ghost:hover, button.ghost:hover { background: rgba(168, 68, 28, 0.08); }
      .card a.button.ghost:hover, .screen a.button.ghost:hover { background: rgba(255, 179, 56, 0.1); }
      /* Disclosure: one chevron + a text label everywhere. */
      details > summary { cursor: pointer; list-style: none; }
      details > summary::-webkit-details-marker { display: none; }
      details > summary::before { content: "›"; display: inline-block; width: 1.1em; color: var(--accent); transition: transform 0.15s ease; }
      details[open] > summary::before { transform: rotate(90deg); }
      button.danger:hover { background: linear-gradient(180deg, #e88066 0%, #c85538 60%, #a8442a 100%); }
      label { display: block; margin: 14px 0 4px; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-family: var(--font-display); font-weight: 600; }
      input, select {
        width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line-hi); background: #f8f1dd; color: var(--btn-ink);
        font-family: var(--font-body); font-size: 15px; box-shadow: inset 0 2px 4px rgba(58, 42, 16, 0.14);
      }
      input:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(168, 68, 28, 0.2), inset 0 2px 4px rgba(58, 42, 16, 0.14); }
      .card input:focus, .card select:focus, .screen input:focus, .screen select:focus { border-color: var(--phos); box-shadow: 0 0 0 3px rgba(255, 179, 56, 0.25), inset 0 2px 4px rgba(58, 42, 16, 0.14); }
      ul { padding-left: 18px; }
      code { background: rgba(255, 179, 56, 0.12); border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; font-size: 0.9em; font-family: var(--font-mono); }
      img.photo { display: block; width: 100%; max-height: 320px; object-fit: contain; border-radius: 6px; border: 1px solid var(--line); margin: 0; background: #000; }
      .drop { color: var(--red); }
      .win { color: var(--phos); }
      .row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
      .qrbox { background: #fff; border-radius: 8px; padding: 8px; line-height: 0; }
      .qrbox svg { width: 140px; height: auto; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
      .chip {
        background: rgba(255, 179, 56, 0.08); color: var(--ink); border: 1px solid var(--line); border-radius: 999px;
        padding: 7px 14px; font-family: var(--font-body); font-size: 0.85rem; font-weight: 400;
        letter-spacing: 0; text-transform: none; text-shadow: none; cursor: pointer; text-decoration: none;
      }
      .chip:hover { background: rgba(255, 179, 56, 0.16); border-color: var(--phos-dim); }
      .err { border: 1px solid var(--red); background: rgba(192, 57, 31, 0.08); color: var(--red); border-radius: 4px; padding: 10px 14px; margin: 12px 0; }
      /* Brand wordmark — same mark on every page. */
      .wordmark { display: inline-block; margin-bottom: 26px; font-family: var(--font-display); font-weight: 800; font-size: 0.85rem; letter-spacing: 0.32em; text-transform: uppercase; color: var(--ink); text-decoration: none; }
      .wordmark::before { content: "> "; color: var(--accent); }
      .wordmark .cursor { color: var(--accent); animation: blink 1.15s steps(1) infinite; }
      /* Demo tape reel. */
      .reel { min-height: 11.2em; font-size: 0.92rem; }
      .reel-line { padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .reel-tag { display: inline-block; width: 6.5em; font-family: var(--font-display); font-size: 0.68rem; letter-spacing: 0.14em; color: var(--muted); }
      .reel-tag.phos { color: var(--phos); }
      .reel-tag.amber { color: var(--amber); }
      .reel-tag.dim { color: var(--phos-dim); }
      .reel-tag.bold { text-shadow: 0 0 12px rgba(255, 179, 56, 0.7); }
      /* First-paint reveal: gentle rise, staggered by position. */
      main > * { animation: rise 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
      main > *:nth-child(2) { animation-delay: 0.06s; }
      main > *:nth-child(3) { animation-delay: 0.12s; }
      main > *:nth-child(n+4) { animation-delay: 0.18s; }
      @keyframes rise { from { opacity: 0; transform: translateY(7px); } }
      @keyframes blink { 50% { opacity: 0; } }
      .badge {
        display: inline-block; padding: 3px 12px; border-radius: 3px; border: 1px solid var(--line);
        font-family: var(--font-display); font-weight: 600; font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted);
      }
      .badge.live { color: var(--accent); border-color: var(--accent); animation: pulse 1.6s ease-in-out infinite; }
      .card .badge.live, .screen .badge.live { text-shadow: 0 0 10px rgba(255, 179, 56, 0.6); }
      .badge.sold { color: var(--amber); border-color: var(--phos-dim); }
      .badge.nosale { color: var(--red); border-color: var(--red); }
      .badge.off { color: var(--muted); }
      .tick { animation: tick 0.5s ease-out; }
      .feed { list-style: none; padding-left: 0; margin: 8px 0 0; font-size: 0.92rem; }
      .feed li { padding: 2px 0; border-bottom: 1px dotted var(--line); }
      .feed li::before { content: "> "; color: var(--accent); }
      /* Market depth bars (landing order book). */
      .depth { list-style: none; padding: 0; margin: 8px 0 0; }
      .depth li { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; }
      .depth .t { flex: 0 0 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .depth .bar { flex: 1; height: 10px; background: rgba(255, 179, 56, 0.08); border: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
      .depth .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--phos-dim), var(--phos)); box-shadow: 0 0 8px rgba(255, 179, 56, 0.4); }
      .depth .n { flex: 0 0 auto; color: var(--muted); font-size: 0.85rem; }
      /* Pixel-bot agent avatar — hue set per instance via --h. */
      .botw { width: 24px; height: 26px; flex: 0 0 auto; }
      .bot { display: block; width: 4px; height: 4px; --c: var(--phos); filter: hue-rotate(var(--h, 0deg));
        box-shadow: 8px 0 var(--c), 0 4px var(--c), 4px 4px var(--c), 8px 4px var(--c), 12px 4px var(--c), 16px 4px var(--c),
          0 8px var(--c), 8px 8px var(--c), 16px 8px var(--c),
          0 12px var(--c), 4px 12px var(--c), 8px 12px var(--c), 12px 12px var(--c), 16px 12px var(--c),
          4px 16px var(--c), 8px 16px var(--c), 12px 16px var(--c), 4px 20px var(--c), 12px 20px var(--c); }
      /* Category pipeline rail — visible product roadmap, clearly not live. */
      .soon-rail { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 22px 0 0; padding: 9px 12px; border: 1px dashed var(--line-hi); border-radius: 6px; }
      .soon-tag { font-family: var(--font-display); font-weight: 600; font-size: 0.62rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); }
      .soon-item { font-size: 0.8rem; color: var(--muted); padding: 3px 11px; border: 1px solid var(--line); border-radius: 999px; }
      .soon-item b { color: var(--accent); font-weight: 400; margin-right: 6px; }
      /* CRT overlay for the live-auction screen. */
      body.crt::before {
        content: ""; position: fixed; inset: 0; z-index: 9998; pointer-events: none;
        background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px);
      }
      body.crt::after {
        content: ""; position: fixed; inset: 0; z-index: 9999; pointer-events: none;
        background: radial-gradient(ellipse at center, transparent 55%, rgba(20, 10, 0, 0.42) 100%);
      }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
      @keyframes tick { 0% { text-shadow: 0 0 34px rgba(255, 179, 56, 0.9); } 100% { text-shadow: 0 0 24px rgba(255, 179, 56, 0.35); } }
      @media (prefers-reduced-motion: reduce) {
        .badge.live { animation: none; }
        .tick { animation: none; }
        .wordmark .cursor { animation: none; }
        main > * { animation: none; }
      }
    </style>
  </head>
  <body${opts.crt ? html` class="crt"` : html``}>
    <main>
      <a class="wordmark" href="/">snapflip<span class="cursor">&#9646;</span></a>
      ${body}
    </main>
  </body>
</html>`;

/** Thrift-store till receipt: paper card, torn edges, barcode keyed to a seed. */
export const receiptStyle = html`<style>
  .receipt { background: #f4efe0; color: #1c1a14; border-radius: 2px; padding: 16px 20px;
    margin: 22px 0; position: relative; box-shadow: 0 3px 14px rgba(58, 42, 16, 0.3);
    font-family: var(--font-mono); }
  .receipt::before, .receipt::after { content: ""; position: absolute; left: 0; right: 0; height: 7px;
    background: linear-gradient(45deg, #f4efe0 5px, transparent 5px) 0 0 / 11px 11px repeat-x,
      linear-gradient(-45deg, #f4efe0 5px, transparent 5px) 0 0 / 11px 11px repeat-x; }
  .receipt::before { top: -7px; }
  .receipt::after { bottom: -7px; transform: scaleY(-1); }
  .receipt h2 { color: #1c1a14; letter-spacing: 0.1em; margin: 0 0 4px; }
  .receipt .muted { color: #6b6552; }
  .receipt ul { margin: 4px 0 10px; }
  .receipt .rule { border-top: 1px dashed #b9b09a; padding-top: 8px; margin-top: 8px; }
  .receipt .bc { display: flex; gap: 1px; height: 34px; justify-content: center; margin: 12px 0 2px; }
  .receipt .bc i { background: #1c1a14; display: block; }
  .receipt .thanks { text-align: center; color: #6b6552; font-size: 0.8rem; letter-spacing: 0.15em;
    text-transform: uppercase; margin: 8px 0 0; }
</style>`;

/** Bars keyed to the seed — deterministic, and it looks like a real till barcode. */
export const barcode = (seed: string) =>
  html`<div class="bc">${seed
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 30)
    .split("")
    .map((ch) => html`<i style="width:${(ch.charCodeAt(0) % 4) + 1}px"></i>`)}</div>`;

/** Category pipeline teaser — exact-identity collectibles beyond games. */
export const soonRail = html`<div class="soon-rail">
  <span class="soon-tag">next on the rack</span>
  <span class="soon-item"><b>&#9673;</b> vinyl</span>
  <span class="soon-item"><b>&#9638;</b> lego</span>
  <span class="soon-item"><b>&#10022;</b> trading cards</span>
  <span class="soon-item">exact identity required</span>
</div>`;

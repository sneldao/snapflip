// Owner: A. Shared page chrome: retro-terminal design system for every SnapFlip web page.
// Aesthetic: cassette-futurism phosphor terminal (fits the retro-games wedge).
// Fonts: Orbitron (display), VT323 (big numerals), Share Tech Mono (body).
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
    <meta name="theme-color" content="#070a08" />
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
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23070a08'/%3E%3Ctext x='2' y='12.5' font-family='monospace' font-size='11' font-weight='bold' fill='%2346ff8f'%3ES%3E%3C/text%3E%3C/svg%3E" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Share+Tech+Mono&family=VT323&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #070a08;
        --panel: #0d130e;
        --panel2: #0a0f0b;
        --line: #1f3a28;
        --line-hi: #2f5a3c;
        --ink: #d8ecd9;
        --muted: #7fa08a;
        --phos: #46ff8f;
        --phos-dim: #1e7a46;
        --amber: #ffb000;
        --red: #ff5f5f;
        --font-body: "Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        --font-display: "Orbitron", "Share Tech Mono", ui-monospace, monospace;
        --font-num: "VT323", "Share Tech Mono", ui-monospace, monospace;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.5; }
      main { max-width: 780px; margin: 0 auto; padding: 36px 20px 64px; }
      h1 { font-family: var(--font-display); font-weight: 800; letter-spacing: 0.04em; font-size: 1.9rem; margin: 0 0 10px; color: var(--phos); text-shadow: 0 0 18px rgba(70, 255, 143, 0.25); }
      h2 { font-family: var(--font-display); font-weight: 600; letter-spacing: 0.06em; font-size: 1rem; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
      a { color: var(--phos); }
      .muted { color: var(--muted); }
      .big { font-family: var(--font-num); font-size: 4.4rem; line-height: 1; color: var(--phos); text-shadow: 0 0 24px rgba(70, 255, 143, 0.35); font-variant-numeric: tabular-nums; }
      .card {
        background: linear-gradient(180deg, var(--panel) 0%, var(--panel2) 100%);
        border: 1px solid var(--line); border-radius: 6px; padding: 16px 18px; margin: 14px 0;
        box-shadow: inset 0 1px 0 rgba(70, 255, 143, 0.06), 0 2px 12px rgba(0, 0, 0, 0.45);
      }
      .card > h2:first-child, .card > .bd:first-child + h2, .panel-title {
        display: block; margin: -16px -18px 12px; padding: 6px 12px;
        border-bottom: 1px solid var(--line); border-radius: 6px 6px 0 0;
        background: rgba(70, 255, 143, 0.05); color: var(--muted);
        font-family: var(--font-display); font-weight: 600; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase;
      }
      a.button, button {
        display: inline-block; background: var(--phos-dim); color: #eafff2; border: 1px solid var(--line-hi); border-radius: 4px;
        padding: 11px 20px; font-family: var(--font-display); font-weight: 600; font-size: 0.82rem; letter-spacing: 0.1em; text-transform: uppercase;
        text-decoration: none; cursor: pointer; text-shadow: 0 0 8px rgba(70, 255, 143, 0.4);
      }
      a.button:hover, button:hover { background: #2a9a58; box-shadow: 0 0 16px rgba(70, 255, 143, 0.35); }
      button.danger { background: #4a1620; border-color: #7a2a38; text-shadow: 0 0 8px rgba(255, 95, 95, 0.4); }
      button.danger:hover { background: #6a1f2c; box-shadow: 0 0 16px rgba(255, 95, 95, 0.3); }
      label { display: block; margin: 14px 0 4px; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-family: var(--font-display); font-weight: 600; }
      input, select {
        width: 100%; padding: 10px 12px; border-radius: 4px; border: 1px solid var(--line); background: #0a0d0b; color: var(--ink);
        font-family: var(--font-body); font-size: 15px;
      }
      input:focus, select:focus { outline: none; border-color: var(--phos); box-shadow: 0 0 10px rgba(70, 255, 143, 0.25); }
      ul { padding-left: 18px; }
      code { background: rgba(70, 255, 143, 0.08); border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; font-size: 0.9em; }
      img.photo { display: block; width: 100%; max-height: 320px; object-fit: contain; border-radius: 6px; border: 1px solid var(--line); margin: 0; background: #000; }
      .drop { color: var(--red); }
      .win { color: var(--phos); }
      .row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
      .qrbox { background: #fff; border-radius: 8px; padding: 8px; line-height: 0; }
      .qrbox svg { width: 140px; height: auto; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
      .chip {
        background: rgba(70, 255, 143, 0.07); color: var(--ink); border: 1px solid var(--line); border-radius: 999px;
        padding: 7px 14px; font-family: var(--font-body); font-size: 0.85rem; font-weight: 400;
        letter-spacing: 0; text-transform: none; text-shadow: none; cursor: pointer;
      }
      .chip:hover { background: rgba(70, 255, 143, 0.14); border-color: var(--phos); box-shadow: 0 0 10px rgba(70, 255, 143, 0.25); }
      .err { border: 1px solid #7a2a38; background: rgba(255, 95, 95, 0.08); color: var(--red); border-radius: 4px; padding: 10px 14px; margin: 12px 0; }
      /* Brand wordmark — same mark on every page. */
      .wordmark { display: inline-block; margin-bottom: 26px; font-family: var(--font-display); font-weight: 800; font-size: 0.85rem; letter-spacing: 0.32em; text-transform: uppercase; color: var(--phos); text-decoration: none; text-shadow: 0 0 14px rgba(70, 255, 143, 0.35); }
      .wordmark::before { content: "> "; color: var(--phos-dim); }
      .wordmark .cursor { animation: blink 1.15s steps(1) infinite; }
      /* Demo tape reel. */
      .reel { min-height: 11.2em; font-size: 0.92rem; }
      .reel-line { padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .reel-tag { display: inline-block; width: 6.5em; font-family: var(--font-display); font-size: 0.68rem; letter-spacing: 0.14em; color: var(--muted); }
      .reel-tag.phos { color: var(--phos); }
      .reel-tag.amber { color: var(--amber); }
      .reel-tag.dim { color: var(--phos-dim); }
      .reel-tag.bold { text-shadow: 0 0 12px rgba(70, 255, 143, 0.7); }
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
      .badge.live { color: var(--phos); border-color: var(--phos-dim); text-shadow: 0 0 10px rgba(70, 255, 143, 0.6); animation: pulse 1.6s ease-in-out infinite; }
      .badge.sold { color: var(--amber); border-color: #6a5200; text-shadow: 0 0 10px rgba(255, 176, 0, 0.5); }
      .badge.nosale { color: var(--red); border-color: #7a2a38; }
      .badge.off { color: var(--muted); }
      .tick { animation: tick 0.5s ease-out; }
      .feed { list-style: none; padding-left: 0; margin: 8px 0 0; font-size: 0.92rem; }
      .feed li { padding: 2px 0; border-bottom: 1px dotted rgba(31, 58, 40, 0.5); }
      .feed li::before { content: "> "; color: var(--phos-dim); }
      /* Market depth bars (landing order book). */
      .depth { list-style: none; padding: 0; margin: 8px 0 0; }
      .depth li { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; }
      .depth .t { flex: 0 0 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .depth .bar { flex: 1; height: 10px; background: rgba(70, 255, 143, 0.08); border: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
      .depth .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--phos-dim), var(--phos)); box-shadow: 0 0 8px rgba(70, 255, 143, 0.4); }
      .depth .n { flex: 0 0 auto; color: var(--muted); font-size: 0.85rem; }
      /* Pixel-bot agent avatar — hue set per instance via --h. */
      .botw { width: 24px; height: 26px; flex: 0 0 auto; }
      .bot { display: block; width: 4px; height: 4px; --c: var(--phos); filter: hue-rotate(var(--h, 0deg));
        box-shadow: 8px 0 var(--c), 0 4px var(--c), 4px 4px var(--c), 8px 4px var(--c), 12px 4px var(--c), 16px 4px var(--c),
          0 8px var(--c), 8px 8px var(--c), 16px 8px var(--c),
          0 12px var(--c), 4px 12px var(--c), 8px 12px var(--c), 12px 12px var(--c), 16px 12px var(--c),
          4px 16px var(--c), 8px 16px var(--c), 12px 16px var(--c), 4px 20px var(--c), 12px 20px var(--c); }
      /* Category pipeline rail — visible product roadmap, clearly not live. */
      .soon-rail { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 22px 0 0; padding: 9px 12px; border: 1px dashed var(--line); border-radius: 6px; }
      .soon-tag { font-family: var(--font-display); font-weight: 600; font-size: 0.62rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--phos-dim); }
      .soon-item { font-size: 0.8rem; color: var(--muted); padding: 3px 11px; border: 1px solid var(--line); border-radius: 999px; }
      .soon-item b { color: var(--phos-dim); font-weight: 400; margin-right: 6px; }
      /* CRT overlay for the live-auction screen. */
      body.crt::before {
        content: ""; position: fixed; inset: 0; z-index: 9998; pointer-events: none;
        background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px);
      }
      body.crt::after {
        content: ""; position: fixed; inset: 0; z-index: 9999; pointer-events: none;
        background: radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.42) 100%);
      }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
      @keyframes tick { 0% { text-shadow: 0 0 34px rgba(70, 255, 143, 0.9); } 100% { text-shadow: 0 0 24px rgba(70, 255, 143, 0.35); } }
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

/** Category pipeline teaser — exact-identity collectibles beyond games. */
export const soonRail = html`<div class="soon-rail">
  <span class="soon-tag">next on the rack</span>
  <span class="soon-item"><b>&#9673;</b> vinyl</span>
  <span class="soon-item"><b>&#9638;</b> lego</span>
  <span class="soon-item"><b>&#10022;</b> trading cards</span>
  <span class="soon-item">exact identity required</span>
</div>`;

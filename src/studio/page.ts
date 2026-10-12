import { html } from "hono/html";

const INITIAL_PROMPT =
  "Build an inspection room for a worn Pokémon Yellow cartridge. Put the label under a raking light; let me inspect the edge and show when a collector capped at $45 walks away.";
const FOLLOWUP_PROMPT = "Move the light to the left and reject this copy if the label is torn.";

export function studioPage(aiEnabled: boolean) {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#141114" />
    <meta name="description" content="SnapFlip Studio — one world, three chapters: discover, inspect, auction." />
    <title>SnapFlip Studio — world blockout</title>
    <style>
      :root {
        color-scheme: dark;
        --porcelain: #ece4d4;
        --porcelain-dim: #b9ae97;
        --charcoal: #141114;
        --panel: rgba(20, 17, 20, 0.86);
        --line: #332d31;
        --amber: #e8a34c;
        --amber-hi: #f5c987;
        --red: #d9644a;
        --ok: #8fb98a;
        --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
        --mono: "SF Mono", ui-monospace, "Cascadia Mono", Menlo, monospace;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; overflow: hidden; background: var(--charcoal); color: var(--porcelain); font-family: var(--serif); }
      button { font: inherit; cursor: pointer; }
      #stage { position: fixed; inset: 0; }
      #stage canvas { display: block; }
      .topbar { position: fixed; top: 12px; left: 12px; z-index: 10; max-width: min(78vw, 420px);
                background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
      .topbar h1 { margin: 0; font-size: 0.95rem; font-weight: 600; letter-spacing: 0.02em; }
      .topbar .sub { font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--porcelain-dim); margin-top: 3px; overflow-wrap: anywhere; }
      .badges { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
      .badge { font-family: var(--mono); font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis;
               border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; color: var(--porcelain-dim); max-width: 100%; }
      .badge.sim { border-color: var(--amber); color: var(--amber); }
      .topbar .status { font-family: var(--mono); font-size: 0.6rem; color: var(--porcelain-dim); margin-top: 7px; }
      .topbar .status b { color: var(--amber-hi); font-weight: 400; }
      .nav { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 10;
             display: flex; gap: 8px; align-items: center; background: var(--panel); border: 1px solid var(--line);
             border-radius: 999px; padding: 7px 10px; max-width: calc(100vw - 16px); flex-wrap: wrap; justify-content: center; }
      .nav button { border: 1px solid var(--line); background: transparent; color: var(--porcelain-dim); border-radius: 999px;
                    padding: 7px 14px; font-family: var(--mono); font-size: 0.66rem; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
      .nav button[aria-pressed="true"] { border-color: var(--amber); color: var(--amber-hi); }
      .nav button:focus-visible, .drawer button:focus-visible, .card button:focus-visible, .marker:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
      .nav .sep { width: 1px; height: 18px; background: var(--line); }
      .card { position: fixed; z-index: 9; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; max-width: 320px; }
      .card .who { font-family: var(--mono); font-size: 0.58rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--porcelain-dim); }
      .card .verdict { font-size: 0.98rem; margin: 3px 0; }
      .card .verdict.in { color: var(--ok); }
      .card .verdict.out { color: var(--red); }
      .card .why { font-size: 0.74rem; color: var(--porcelain-dim); line-height: 1.4; overflow-wrap: anywhere; }
      .card .price { font-family: var(--mono); font-size: 0.7rem; color: var(--amber-hi); margin-top: 4px; }
      #decision { top: 12px; right: 12px; border-left: 3px solid var(--amber); }
      #evidence-card { top: 50%; right: 12px; transform: translateY(-50%); border-left: 3px solid var(--ok); }
      .markers { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
      .marker { position: absolute; transform: translate(-50%, -120%); pointer-events: auto;
                font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.04em;
                background: var(--panel); border: 1px solid var(--amber); color: var(--amber-hi);
                border-radius: 5px; padding: 4px 8px; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
      .marker .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--amber); margin-right: 6px; vertical-align: 1px; }
      #webgl-fallback { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 4; display: none;
                        background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px;
                        font-size: 0.78rem; color: var(--porcelain-dim); max-width: min(92vw, 480px); text-align: center; }
      .drawer { position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 11; width: min(560px, calc(100vw - 16px));
                background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: none; }
      .drawer.open { display: block; }
      .drawer textarea { width: 100%; min-height: 84px; resize: vertical; background: #1c181c; color: var(--porcelain);
                         border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-family: var(--serif); font-size: 0.85rem; line-height: 1.45; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .btn { border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--porcelain); padding: 7px 14px; font-size: 0.78rem; }
      .btn.primary { background: var(--amber); border-color: var(--amber); color: #1b1206; font-weight: 600; }
      .btn:disabled { opacity: 0.45; cursor: default; }
      .hint { font-size: 0.72rem; color: var(--porcelain-dim); line-height: 1.5; overflow-wrap: anywhere; margin: 8px 0 0; }
      .hint code { font-family: var(--mono); font-size: 0.66rem; color: var(--amber-hi); overflow-wrap: anywhere; }
      .err { border: 1px solid var(--red); color: var(--red); border-radius: 6px; padding: 8px 10px; font-size: 0.74rem; overflow-wrap: anywhere; margin-top: 8px; }
      .lbl { font-family: var(--mono); font-size: 0.58rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--porcelain-dim); margin: 12px 0 6px; }
      .chip { border: 1px solid var(--line); background: transparent; color: var(--porcelain-dim); border-radius: 999px;
              padding: 5px 12px; font-family: var(--mono); font-size: 0.64rem; letter-spacing: 0.08em; text-transform: uppercase; }
      .chip[aria-pressed="true"] { border-color: var(--amber); color: var(--amber-hi); }
      #photo-input { font-family: var(--mono); font-size: 0.64rem; color: var(--porcelain-dim); max-width: 100%; }
      .thumbs img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); }
      #diag { position: fixed; left: 12px; bottom: 64px; z-index: 8; background: var(--panel); border: 1px solid var(--line);
              border-radius: 8px; padding: 8px 10px; font-family: var(--mono); font-size: 0.6rem; color: var(--porcelain-dim);
              letter-spacing: 0.04em; line-height: 1.7; white-space: pre; }
      #gesture-hint { position: fixed; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 9;
                      background: var(--panel); border: 1px solid var(--amber); border-radius: 999px; padding: 7px 16px;
                      font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.08em; color: var(--amber-hi);
                      white-space: nowrap; max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis;
                      transition: opacity 0.6s ease; }
      #gesture-hint .done { color: var(--porcelain-dim); text-decoration: line-through; }
      #gesture-hint.fade { opacity: 0; pointer-events: none; }
      @media (max-width: 860px) {
        .badge { font-size: 0.54rem; white-space: normal; overflow-wrap: anywhere; text-align: center; }
        .topbar { max-width: calc(100vw - 24px); padding: 8px 12px; }
        .card { max-width: calc(100vw - 24px); }
        #decision { top: auto; bottom: 122px; right: 12px; left: 12px; max-width: none; }
        #evidence-card { top: auto; bottom: 122px; right: 12px; left: 12px; max-width: none; transform: none; }
        .nav { bottom: 10px; padding: 6px 8px; gap: 6px; }
        .nav button { padding: 7px 11px; }
        .drawer { bottom: 60px; }
        #gesture-hint { bottom: 178px; }
      }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <div class="markers" id="markers"></div>
    <div id="webgl-fallback" role="status">WebGL isn&rsquo;t available in this browser. The scene spec and simulated decision still work via the controls below.</div>

    <header class="topbar">
      <h1>SnapFlip Studio</h1>
      <div class="sub">world blockout &middot; <span id="prov-item">demo item proxy</span> &middot; <span id="prov-photos">no source photos</span></div>
      <div class="badges">
        <span class="badge sim">SAMPLE &middot; SIMULATED</span>
        <span class="badge" id="prov-badge">procedural proxy</span>
        <span class="badge">scenario, unverified</span>
      </div>
      <div class="status">scene <b id="tl-scene">sample</b> &middot; condition <b id="tl-cond">worn</b> &middot; agent <b id="tl-agent">in</b></div>
    </header>

    <div class="card" id="decision" hidden>
      <div class="who">simulated collector &middot; scenario, unverified</div>
      <div class="verdict" id="verdict">—</div>
      <div class="why" id="why"></div>
      <div class="price" id="price"></div>
    </div>

    <div class="card" id="evidence-card" hidden>
      <div class="who">evidence point &middot; procedural proxy, not a reconstruction</div>
      <div class="verdict" id="ev-title">—</div>
      <div class="why" id="ev-detail"></div>
    </div>

    <div id="diag" hidden></div>

    <nav class="nav" aria-label="Chapters">
      <button type="button" data-ch="0" aria-pressed="true">Discover</button>
      <button type="button" data-ch="1" aria-pressed="false">Inspect</button>
      <button type="button" data-ch="2" aria-pressed="false">Auction</button>
      <span class="sep"></span>
      <button type="button" id="btn-scenario" aria-pressed="false">Scenario</button>
      <button type="button" id="btn-direct" aria-pressed="false">Direct scene</button>
      <button type="button" id="btn-reset">Reset view</button>
      <button type="button" id="btn-sound" aria-pressed="true">Sound on</button>
    </nav>

    <div id="gesture-hint" hidden></div>

    <div class="drawer" id="drawer">
      <div id="panel-direct" hidden>
        <form id="director-form">
          <textarea id="prompt" maxlength="500" aria-label="Scene instruction">${INITIAL_PROMPT}</textarea>
          <div class="row" style="margin-top: 8px">
            <button type="submit" class="btn primary" id="send" ${aiEnabled ? "" : "disabled"}>Direct scene</button>
            <button type="button" class="btn" id="load-sample">Load sample</button>
            <button type="button" class="btn" id="undo" disabled>Undo scene edit</button>
          </div>
        </form>
        ${aiEnabled
          ? html``
          : html`<p class="hint">AI preview is not enabled on this deployment — the sample scene and direct controls still work.</p>`}
        <p class="hint">Refine the same scene, e.g.<br /><code>${FOLLOWUP_PROMPT}</code></p>
        <div class="err" id="model-error" hidden></div>
      </div>
      <div id="panel-scenario" hidden>
        <div class="lbl">Condition scenario &middot; simulated, unverified</div>
        <div class="row" role="group" aria-label="Condition scenario">
          <button type="button" class="chip" data-cond="clean">clean</button>
          <button type="button" class="chip" data-cond="worn" aria-pressed="true">worn</button>
          <button type="button" class="chip" data-cond="torn">torn</button>
          <button type="button" class="chip" data-cond="chipped" hidden>chipped</button>
        </div>
        <div class="lbl">Simulated scenario rule &middot; no real order or payment</div>
        <div class="row">
          <button type="button" class="chip" id="rule-toggle" aria-pressed="false">reject if damaged</button>
        </div>
        <div class="lbl">Raking light</div>
        <div class="row" role="group" aria-label="Raking light side">
          <button type="button" class="chip" data-light="left">left</button>
          <button type="button" class="chip" data-light="right" aria-pressed="true">right</button>
        </div>
        ${aiEnabled
          ? html`
        <div class="lbl">Source photos &middot; demo uploads, unverified</div>
        <div class="row">
          <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple aria-label="Upload source photos" />
          <button type="button" class="chip" id="photo-clear" hidden>clear</button>
        </div>
        <div class="row thumbs" id="photo-list"></div>
        <p class="hint">Up to 4 images &middot; the first two mount on the inspection plates as unverified source photos.</p>
        <div class="err" id="photo-error" hidden></div>`
          : html``}
      </div>
    </div>

    <script type="module" src="/app/client.js"></script>
  </body>
</html>`;
}

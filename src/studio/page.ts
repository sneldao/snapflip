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
      #boot { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
              background: var(--charcoal); transition: opacity 0.7s ease; }
      #boot.done { opacity: 0; pointer-events: none; }
      #boot .inner { text-align: center; max-width: min(80vw, 360px); }
      #boot .mark { font-size: 1.5rem; letter-spacing: 0.02em; }
      #boot .mark b { color: var(--amber-hi); font-weight: 600; }
      #boot .tag { font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.22em; text-transform: uppercase;
                   color: var(--porcelain-dim); margin-top: 6px; }
      #boot .bar { height: 2px; background: var(--line); border-radius: 2px; margin: 18px 0 10px; overflow: hidden; }
      #boot .bar span { display: block; height: 100%; width: 5%; background: var(--amber);
                        border-radius: 2px; transition: width 0.5s ease; }
      #boot .line { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase;
                    color: var(--porcelain-dim); }
      #boot .line.err { color: var(--red); text-transform: none; }
      #intro { top: 50%; right: 12px; transform: translateY(-50%); border-left: 3px solid var(--amber); }
      #intro .cta { margin-top: 9px; }
      #appraisal { left: 12px; bottom: 64px; border-left: 3px solid var(--amber); }
      #appraisal .verdict { font-family: var(--mono); font-size: 1.05rem; }
      #appraisal.down { border-left-color: var(--red); }
      #appraisal.up { border-left-color: var(--ok); }
      #diag { bottom: 150px; }
      #listing { position: fixed; inset: 0; z-index: 45; background: #e9e7e2; color: #2a2a2a;
                 display: flex; align-items: center; justify-content: center; padding: 16px;
                 font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                 transition: opacity 0.8s ease, transform 0.8s ease; }
      #listing.lift { opacity: 0; transform: scale(0.94) translateY(-20px); pointer-events: none; }
      #listing .sheet { width: min(92vw, 640px); background: #fff; border: 1px solid #d8d5cf; border-radius: 4px;
                        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14); padding: 18px 20px; }
      #listing .site { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a958c; margin-bottom: 14px; }
      #listing .rowx { display: flex; gap: 16px; }
      #listing .photo { width: 170px; min-width: 170px; height: 170px; border: 1px solid #ddd;
                        background: repeating-linear-gradient(45deg, #ededeb, #ededeb 9px, #f6f6f4 9px, #f6f6f4 18px);
                        display: flex; align-items: center; justify-content: center; text-align: center;
                        color: #a9a49a; font-size: 10px; line-height: 1.6; letter-spacing: 0.12em; text-transform: uppercase; }
      #listing h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; color: #222; }
      #listing .cond { font-size: 12px; color: #555; }
      #listing .cond b { color: #1a7a33; }
      #listing .price { font-size: 20px; font-weight: 700; color: #222; margin: 8px 0 2px; }
      #listing .seller { font-size: 11px; color: #9a958c; margin-top: 8px; line-height: 1.6; }
      #listing .prompt-line { margin-top: 16px; border-top: 1px dashed #ddd; padding-top: 14px; }
      #listing .prompt-text { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; line-height: 1.6;
                              background: #f6f3ea; border: 1px solid #e2dbc6; border-radius: 3px; color: #6b5a2e;
                              padding: 9px 11px; min-height: 34px; }
      #listing .actions { margin-top: 10px; display: flex; align-items: center; gap: 10px; }
      #listing .go { background: #141114; color: #f5c987; border: 0; padding: 9px 18px; font-size: 11px;
                     letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; border-radius: 3px; font-family: inherit; }
      #listing .skip { background: none; border: 0; padding: 0; font-size: 11px; color: #9a958c;
                       text-decoration: underline; cursor: pointer; font-family: inherit; }
      #listing .fineprint { font-size: 10px; color: #b3aea4; margin-top: 12px; line-height: 1.6; }
      #beat { position: fixed; left: 50%; bottom: 23%; transform: translateX(-50%) translateY(8px); z-index: 12;
              max-width: min(88vw, 560px); text-align: center; pointer-events: none;
              font-style: italic; font-size: 1.08rem; letter-spacing: 0.01em; color: var(--porcelain);
              text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85), 0 0 40px rgba(0, 0, 0, 0.6);
              opacity: 0; transition: opacity 0.8s ease, transform 0.8s ease; }
      #beat.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      @media (max-width: 860px) {
        .badge { font-size: 0.54rem; white-space: normal; overflow-wrap: anywhere; text-align: center; }
        .topbar { max-width: calc(100vw - 24px); padding: 8px 12px; }
        .card { max-width: calc(100vw - 24px); }
        #decision { top: auto; bottom: 122px; right: 12px; left: 12px; max-width: none; }
        #evidence-card { top: auto; bottom: 122px; right: 12px; left: 12px; max-width: none; transform: none; }
        #intro { top: auto; bottom: 122px; right: 12px; left: 12px; max-width: none; transform: none; }
        #appraisal { bottom: 122px; }
        #listing .rowx { flex-direction: column; }
        #listing .photo { width: 100%; height: 110px; min-width: 0; }
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
    <div id="boot" role="status" aria-live="polite">
      <div class="inner">
        <div class="mark">SnapFlip <b>Studio</b></div>
        <div class="tag">one world &middot; discover &middot; inspect &middot; auction</div>
        <div class="bar"><span id="boot-bar"></span></div>
        <div class="line" id="boot-line">waking up</div>
      </div>
    </div>
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
      <div class="who">MARA &middot; simulated collector &middot; scenario, unverified</div>
      <div class="verdict" id="verdict">—</div>
      <div class="why" id="why"></div>
      <div class="price" id="price"></div>
    </div>

    <div class="card" id="evidence-card" hidden>
      <div class="who">evidence point &middot; procedural proxy, not a reconstruction</div>
      <div class="verdict" id="ev-title">—</div>
      <div class="why" id="ev-detail"></div>
    </div>

    <div class="card" id="intro" hidden>
      <div class="who">lot 07 &middot; found in the racks</div>
      <div class="verdict">A worn cartridge, tagged and waiting.</div>
      <div class="why">Take it to the inspection table to check its evidence — then watch a simulated collector decide, and walk if the rules say so.</div>
      <div class="cta"><button type="button" class="btn primary" id="intro-go">Take it to inspection</button></div>
    </div>

    <div class="card" id="appraisal" hidden>
      <div class="who">simulated appraisal &middot; unverified</div>
      <div class="verdict" id="cap-val">$0.00</div>
      <div class="why" id="cap-note">scenario appraisal &mdash; collector&rsquo;s ceiling</div>
    </div>

    <div id="listing" hidden>
      <div class="sheet">
        <div class="site">generic marketplace &middot; this is a listing today</div>
        <div class="rowx">
          <div class="photo">seller photo<br />unverified</div>
          <div>
            <h2>Pok&eacute;mon Yellow &mdash; Game Boy cartridge</h2>
            <div class="cond">Condition: <b id="listing-claim">Mint</b> &mdash; seller&rsquo;s word</div>
            <div class="price">$48.00</div>
            <div class="seller">seller: rack_rat_88 &middot; 1 photo &middot; no returns &middot; ships in 3 days</div>
          </div>
        </div>
        <div class="prompt-line">
          <div class="prompt-text" id="listing-prompt"></div>
          <div class="actions">
            <button type="button" class="go" id="listing-go">Enter the world</button>
            <button type="button" class="skip" id="listing-skip">skip intro</button>
          </div>
          <div class="fineprint">SnapFlip Studio &middot; staged sample listing &middot; no real item, sale, or photos</div>
        </div>
      </div>
    </div>

    <div id="beat" aria-live="polite"></div>
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

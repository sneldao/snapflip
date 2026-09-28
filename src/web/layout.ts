import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

export const layout = (title: string, body: Body) => html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { margin: 0; background: #0b0b10; color: #f3f3f7; }
      main { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
      h1 { font-size: 2.2rem; margin: 0 0 8px; }
      .muted { color: #9a9aad; }
      .big { font-size: 4rem; font-weight: 800; font-variant-numeric: tabular-nums; }
      .card { background: #16161f; border-radius: 12px; padding: 16px; margin: 12px 0; }
      a.button, button { display: inline-block; background: #7c5cff; color: #fff; border: 0; border-radius: 10px;
        padding: 12px 18px; font-size: 1rem; text-decoration: none; cursor: pointer; }
      label { display: block; margin: 12px 0 4px; }
      input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #111; color: #fff; box-sizing: border-box; }
      ul { padding-left: 18px; }
      .drop { color: #ff7b7b; }
      .win { color: #5dff9d; }
      .row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
      .qrbox { background: #fff; border-radius: 8px; padding: 8px; line-height: 0; }
      .qrbox svg { width: 140px; height: auto; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;

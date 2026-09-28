// Usage: npm run tg:webhook -- https://<your-tunnel-or-workers-url>
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .dev.vars.
import { readFileSync } from "node:fs";

const base = process.argv[2];
if (!base) {
  console.error("Usage: npm run tg:webhook -- https://your-url");
  process.exit(1);
}
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const res = await fetch(`https://api.telegram.org/bot${vars.TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${base.replace(/\/$/, "")}/telegram/webhook`,
    secret_token: vars.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  }),
});
console.log(await res.json());

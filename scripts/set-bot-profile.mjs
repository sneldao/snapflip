// Usage: npm run tg:profile
// Sets the bot's command list and profile blurbs. Reads TELEGRAM_BOT_TOKEN from .dev.vars.
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!vars.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN missing from .dev.vars");
  process.exit(1);
}
const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${vars.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log(`${method}: ${json.ok ? "ok" : `FAILED — ${json.description}`}`);
  return json.ok;
};

let allOk = true;
allOk =
  (await call("setMyCommands", {
    commands: [
      { command: "start", description: "How SnapFlip works" },
      { command: "help", description: "How SnapFlip works" },
    ],
  })) && allOk;
allOk =
  (await call("setMyShortDescription", {
    short_description: "Sold before you buy it. Snap a cartridge, agents bid in 60s.",
  })) && allOk;
allOk =
  (await call("setMyDescription", {
    description:
      "Snap a retro game on the thrift rack. SnapFlip identifies and grades it, then buyer agents holding real money bid in a 60-second auction — so you know it's sold before you pay for it.",
  })) && allOk;
process.exit(allOk ? 0 : 1);

// Owner: E. Serves the platform's Agent Card (buildAgentCard lives in ./lib/concordium).
// The raw body is what gets SHA-256'd on-chain, so this route must stay byte-deterministic
// for a given env — pretty-printed JSON, no runtime-only fields.
import { Hono } from "hono";
import { bindAgentBadge, buildAgentCard, CARD_URI, unbindAgentBadge } from "./lib/concordium";
import { requireApiKey, type App } from "./lib/util";

export const agentcard = new Hono<App>();

agentcard.get(CARD_URI, (c) => {
  return new Response(JSON.stringify(buildAgentCard(c.env), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
  });
});

/** Operator path to bind a buyer's agent badge (the collector path is the
 *  link_concordium_badge MCP tool). Verifies against the registry before storing. */
agentcard.post("/api/agent-identity", requireApiKey, async (c) => {
  const { buyerId, badge } = await c.req.json<{ buyerId?: string; badge?: string }>();
  if (!buyerId || !badge) return c.json({ error: "buyerId and badge required" }, 400);
  try {
    return c.json({ ok: true, ...(await bindAgentBadge(c.env, buyerId, badge)) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

agentcard.delete("/api/agent-identity/:buyerId", requireApiKey, async (c) => {
  await unbindAgentBadge(c.env, c.req.param("buyerId"));
  return c.json({ ok: true });
});

// Owner: D. Real-world sold-price comps via Tavily web search — backs the desk's
// "what's it worth" game when SnapFlip tape is thin or the item is off-catalog.
// The Tavily key stays server-side; callers get extracted prices, not raw search.
import { Hono } from "hono";
import type { App } from "./lib/util";
import type { Env } from "./types";

export const market = new Hono<App>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Uncached lookups allowed per minute — protects the search quota from a hot endpoint. */
const RATE_LIMIT_PER_MIN = 20;
/** Price sanity bounds: a collectible comp below $1 or above $50k is a parse error. */
const MIN_CENTS = 100;
const MAX_CENTS = 5_000_000;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

function dollarsFrom(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g)) {
    const cents = Math.round(parseFloat(m[1].replace(/,/g, "") + "." + (m[2] ?? "0").padEnd(2, "0").slice(0, 2)) * 100);
    if (cents >= MIN_CENTS && cents <= MAX_CENTS) out.push(cents);
  }
  return out;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function searchSoldPrices(env: Env, query: string) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query: `"${query}" sold price`,
      search_depth: "basic",
      max_results: 6,
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const data = (await res.json()) as TavilyResponse;

  const results = (data.results ?? []).slice(0, 6).map((r) => ({
    title: (r.title ?? "").slice(0, 140),
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 300),
  }));
  const prices = [...new Set(results.flatMap((r) => dollarsFrom(r.title + " " + r.snippet)))].sort((a, b) => a - b);
  return {
    query,
    answer: typeof data.answer === "string" ? data.answer.slice(0, 500) : null,
    results,
    pricesCents: prices,
    medianCents: median(prices),
  };
}

market.get("/api/market", async (c) => {
  const raw = c.req.query("q") ?? "";
  const query = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (query.length < 2 || query.length > 140) return c.json({ error: "q must be 2-140 chars" }, 400);
  if (!c.env.TAVILY_API_KEY) return c.json({ error: "market lookup not configured" }, 503);

  const cached = await c.env.DB.prepare("SELECT payload, fetched_at FROM market_cache WHERE query = ?")
    .bind(query)
    .first<{ payload: string; fetched_at: string }>();
  if (cached && Date.now() - Date.parse(cached.fetched_at + (cached.fetched_at.endsWith("Z") ? "" : "Z")) < CACHE_TTL_MS) {
    return c.json({ ...JSON.parse(cached.payload), cached: true });
  }

  const calls = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM market_calls WHERE at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')",
  ).first<{ n: number }>();
  if ((calls?.n ?? 0) >= RATE_LIMIT_PER_MIN) return c.json({ error: "rate limited" }, 429);

  let payload;
  try {
    await c.env.DB.prepare("INSERT INTO market_calls DEFAULT VALUES").run();
    payload = await searchSoldPrices(c.env, query);
  } catch {
    return c.json({ error: "market lookup failed" }, 502);
  }

  await c.env.DB.prepare("INSERT OR REPLACE INTO market_cache (query, payload) VALUES (?, ?)")
    .bind(query, JSON.stringify(payload))
    .run();
  return c.json({ ...payload, cached: false });
});

// Owner: D. Real-world market comps for the desk's "what's it worth" games.
// Two tapes, labelled separately for callers:
//   - "pricecharting": structured collector price index (loose / CIB / new),
//     pulled through Tavily Extract on PriceCharting's public pages. Preferred
//     for catalog items — games, cards, comics.
//   - "web": Tavily search snippets, used when the item is off-catalog.
// The Tavily key stays server-side; callers get extracted prices, not raw keys.
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

interface ExtractResult {
  url?: string;
  raw_content?: string;
}

interface ExtractResponse {
  results?: ExtractResult[];
}

interface PCVariant {
  title: string;
  set: string;
  lowCents: number | null;
  midCents: number | null;
  highCents: number | null;
  regional: boolean;
}

function dollarsFrom(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g)) {
    const cents = Math.round(parseFloat(m[1].replace(/,/g, "") + "." + (m[2] ?? "0").padEnd(2, "0").slice(0, 2)) * 100);
    if (cents >= MIN_CENTS && cents <= MAX_CENTS) out.push(cents);
  }
  return out;
}

function dollarsCell(text: string): number | null {
  const p = dollarsFrom(text);
  return p.length ? p[0] : null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Rows of PriceCharting's markdown search table -> variants. Header columns are
 * Loose/CIB/New on game pages, Low/Mid/High elsewhere — positionally identical. */
function parsePriceCharting(text: string): PCVariant[] {
  const out: PCVariant[] = [];
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((s) => s.trim()).filter(Boolean);
    const prices = cells.map(dollarsCell);
    const priceIdx = cells.findIndex((cell) => /^\s*\$/.test(cell));
    if (priceIdx < 0) continue; // header/separator rows carry no $
    const titleRaw = cells[0] ?? "";
    const title = titleRaw
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[[\]]|\([^)]*\)|"/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const set = cells[1] ?? "";
    const v: PCVariant = {
      title,
      set,
      lowCents: prices[priceIdx] ?? null,
      midCents: prices[priceIdx + 1] ?? null,
      highCents: prices[priceIdx + 2] ?? null,
      regional: /\bJP\b|\bPAL\b|not for resale|not-for-resale/i.test(title + " " + set),
    };
    out.push(v);
  }
  return out;
}

/** Best row for the query: a US/base title sharing the most query tokens.
 * Returns the variant plus its token coverage (matched/query tokens) so callers
 * can sanity-check that the catalog hit really is the item asked about. */
function pickVariant(variants: PCVariant[], query: string): { v: PCVariant; coverage: number } | null {
  if (!variants.length) return null;
  const tokens = [...new Set(query.split(" ").filter((t) => t.length > 2))];
  const score = (v: PCVariant) => {
    const t = (v.title + " " + v.set).toLowerCase();
    let s = 0;
    for (const tok of tokens) if (t.includes(tok)) s += 2;
    if (v.regional) s -= 3;
    if (/\[/.test(v.title)) s -= 1; // bracketed special editions are rarely the base item
    if (v.lowCents == null) s -= 1;
    return s;
  };
  const v = variants.slice().sort((a, b) => score(b) - score(a))[0];
  const t = (v.title + " " + v.set).toLowerCase();
  const coverage = tokens.length ? tokens.filter((tok) => t.includes(tok)).length / tokens.length : 0;
  return { v, coverage };
}

async function tavilyExtract(env: Env, url: string): Promise<string | null> {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ api_key: env.TAVILY_API_KEY, urls: url, extract_depth: "basic", format: "text" }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as ExtractResponse;
  return data.results?.[0]?.raw_content ?? null;
}

async function lookupPriceCharting(env: Env, query: string) {
  const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;
  const text = await tavilyExtract(env, url);
  if (!text) return null;
  const variants = parsePriceCharting(text).slice(0, 6);
  const picked = pickVariant(variants, query);
  if (!picked) return null;
  const { v: primary, coverage } = picked;
  // A catalog row sharing under half the query's words is likely a different
  // product (e.g. a game named after a toy) — let the caller fall back to web.
  if (coverage < 0.5) return null;
  const looses = variants.map((v) => v.lowCents).filter((c): c is number => c != null).sort((a, b) => a - b);
  const payload: Record<string, unknown> = {
    source: "pricecharting",
    query,
    answer: null,
    pricecharting: {
      url,
      title: primary.title,
      set: primary.set,
      looseCents: primary.lowCents,
      cibCents: primary.midCents,
      newCents: primary.highCents,
      matchCoverage: Math.round(coverage * 100) / 100,
      variants: variants.map((v) => ({ title: v.title, set: v.set, looseCents: v.lowCents, cibCents: v.midCents, newCents: v.highCents })),
    },
    results: [],
    pricesCents: looses,
    medianCents: median(looses),
  };
  // Marginal catalog match → also attach web comps so the desk can compare
  // tapes instead of quoting a possibly-wrong product.
  if (coverage < 0.75) {
    try {
      const web = await searchSoldPrices(env, query);
      Object.assign(payload, {
        answer: web.answer,
        results: web.results,
        webPricesCents: web.pricesCents,
        webMedianCents: web.medianCents,
      });
    } catch { /* index data alone is still worth returning */ }
  }
  return payload;
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
    source: "web" as const,
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
    // Structured collector index first; fall back to web snippets off-catalog.
    payload = (await lookupPriceCharting(c.env, query).catch(() => null)) ?? (await searchSoldPrices(c.env, query));
  } catch {
    return c.json({ error: "market lookup failed" }, 502);
  }

  await c.env.DB.prepare("INSERT OR REPLACE INTO market_cache (query, payload) VALUES (?, ?)")
    .bind(query, JSON.stringify(payload))
    .run();
  return c.json({ ...payload, cached: false });
});

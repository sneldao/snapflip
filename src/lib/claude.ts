import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";

export function claude(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** True when at least one model provider is configured (dev stubs key off this). */
export function llmAvailable(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.FEATHERLESS_API_KEY);
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } };

const FEATHERLESS_URL = "https://api.featherless.ai/v1/chat/completions";
// Vision-capable default so image calls (identify/grade) work through the same config knob.
const FEATHERLESS_DEFAULT_MODEL = "Qwen/Qwen2.5-VL-72B-Instruct";

/** Anthropic content blocks → OpenAI content parts (data-URI images for vision models). */
function toOpenAIContent(content: ContentBlock[]) {
  return content.map((b) => {
    if (b.type === "text") return { type: "text" as const, text: b.text };
    if (b.type === "image") {
      return { type: "image_url" as const, image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    }
    throw new Error(`unsupported content block: ${(b as { type: string }).type}`);
  });
}

function extractJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`model returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

// Hard cap per provider attempt so a hung API fails fast into the fallback
// instead of stalling the request (and re-paying the full input on the retry).
const PROVIDER_TIMEOUT_MS = 20_000;

async function anthropicJson<T>(
  env: Env,
  opts: { system: string; content: Anthropic.MessageParam["content"]; maxTokens?: number },
): Promise<T> {
  const res = await claude(env).messages.create(
    {
      model: env.CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      // Ephemeral prompt caching: the catalog prefix in the system prompt is
      // stable across calls, so repeat reads bill at ~10% of input price.
      system: [
        {
          type: "text",
          text: `${opts.system}\n\nRespond with a single JSON object and nothing else.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: opts.content }],
    },
    { timeout: PROVIDER_TIMEOUT_MS },
  );
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return extractJson(text);
}

async function featherlessJson<T>(
  env: Env,
  opts: { system: string; content: ContentBlock[]; maxTokens?: number },
): Promise<T> {
  const res = await fetch(FEATHERLESS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.FEATHERLESS_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.FEATHERLESS_MODEL || FEATHERLESS_DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      messages: [
        { role: "system", content: `${opts.system}\n\nRespond with a single JSON object and nothing else.` },
        { role: "user", content: toOpenAIContent(opts.content) },
      ],
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`featherless ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

/** SHA-256 of the full request — two identical asks (same system + content) share one response. */
async function requestHash(opts: { system: string; content: ContentBlock[] }): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([opts.system, opts.content])),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callProvider<T>(
  env: Env,
  opts: { system: string; content: ContentBlock[]; maxTokens?: number },
): Promise<T> {
  if (env.ANTHROPIC_API_KEY) {
    try {
      return await anthropicJson(env, opts);
    } catch (e) {
      console.error("anthropic call failed, trying fallback provider:", (e as Error).message);
    }
  }
  if (env.FEATHERLESS_API_KEY) return featherlessJson(env, opts);
  throw new Error("no model provider configured (need ANTHROPIC_API_KEY or FEATHERLESS_API_KEY)");
}

/**
 * Ask a model for a JSON object. The system prompt must describe the exact shape.
 * Provider order: Anthropic → Featherless (OpenAI-compatible). A failed primary call
 * falls through to the next provider rather than failing the request.
 *
 * Responses are cached in D1 keyed on the request hash: identical requests (photo
 * re-sends, webhook retries, repeated order text) replay at zero token cost.
 */
export async function claudeJson<T>(
  env: Env,
  opts: { system: string; content: ContentBlock[]; maxTokens?: number },
): Promise<T> {
  const key = await requestHash(opts);
  try {
    const hit = await env.DB.prepare("SELECT response FROM llm_cache WHERE key = ?").bind(key).first<{ response: string }>();
    if (hit) return JSON.parse(hit.response) as T;
  } catch {
    // Cache read failure must never block a live call.
  }

  const out = await callProvider<T>(env, opts);

  try {
    await env.DB.prepare("INSERT OR IGNORE INTO llm_cache (key, response) VALUES (?, ?)")
      .bind(key, JSON.stringify(out))
      .run();
  } catch {
    // Cache write failure must never fail the call.
  }
  return out;
}

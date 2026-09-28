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

async function anthropicJson<T>(
  env: Env,
  opts: { system: string; content: Anthropic.MessageParam["content"]; maxTokens?: number },
): Promise<T> {
  const res = await claude(env).messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: `${opts.system}\n\nRespond with a single JSON object and nothing else.`,
    messages: [{ role: "user", content: opts.content }],
  });
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
  });
  if (!res.ok) throw new Error(`featherless ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

/**
 * Ask a model for a JSON object. The system prompt must describe the exact shape.
 * Provider order: Anthropic → Featherless (OpenAI-compatible). A failed primary call
 * falls through to the next provider rather than failing the request.
 */
export async function claudeJson<T>(
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

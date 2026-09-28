import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";

export function claude(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** Ask Claude for a JSON object. The system prompt must describe the exact shape. */
export async function claudeJson<T>(
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
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`Claude returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

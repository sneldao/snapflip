// Per-buyer tokens: authenticate MCP and concierge callers without an account system.
// The raw token is shown once (connector URL / Set-Cookie); only the SHA-256 hash is stored.
import type { Env } from "../types";

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function newBuyerToken(): Promise<{ token: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = `sf_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { token, hash: await sha256Hex(token) };
}

export async function buyerIdForToken(env: Env, token?: string): Promise<string | null> {
  if (!token) return null;
  const row = await env.DB.prepare("SELECT id FROM buyers WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ id: string }>();
  return row?.id ?? null;
}

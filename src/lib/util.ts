import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";

export type App = { Bindings: Env };

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isDev(env: Env): boolean {
  return env.ENVIRONMENT === "dev";
}

export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

/** Server-to-server auth: `Authorization: Bearer <API_KEY>` or `x-api-key`. */
export const requireApiKey: MiddlewareHandler<App> = async (c, next) => {
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const key = bearer ?? c.req.header("x-api-key");
  if (!safeEqual(key, c.env.API_KEY)) return c.json({ error: "unauthorized" }, 401);
  await next();
};

export const devOnly: MiddlewareHandler<App> = async (c, next) => {
  if (!isDev(c.env)) return c.json({ error: "not found" }, 404);
  await next();
};

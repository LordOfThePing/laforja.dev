import type { Context, Env } from 'hono';
import { createMiddleware } from 'hono/factory';

export type RateLimitRule = { limit: number; windowMs: number };

type Bucket = { count: number; resetAt: number };

// Ventana fija en memoria. Alcanza porque corre una sola instancia de api; si se escala
// horizontalmente, esto tiene que pasar a Postgres o Redis.
export function createRateLimiter({ limit, windowMs }: RateLimitRule, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();
  let nextSweep = now() + windowMs;

  function sweep(t: number) {
    if (t < nextSweep) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= t) buckets.delete(key);
    }
    nextSweep = t + windowMs;
  }

  return {
    hit(key: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
      const t = now();
      sweep(t);
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= t) {
        bucket = { count: 0, resetAt: t + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count <= limit) return { allowed: true };
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
    },
    size: () => buckets.size,
  };
}

export function rateLimit<E extends Env>(
  rule: RateLimitRule,
  key: (c: Context<E>) => string,
  now?: () => number,
) {
  const limiter = createRateLimiter(rule, now);
  return createMiddleware<E>(async (c, next) => {
    const result = limiter.hit(key(c));
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSec));
      return c.json({ error: 'rate_limited' }, 429);
    }
    await next();
  });
}

// La api solo escucha en 127.0.0.1 y le llega todo vía el proxy (Nginx o Cloudflare Tunnel),
// así que estos headers los pone el proxy y no el cliente.
export function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

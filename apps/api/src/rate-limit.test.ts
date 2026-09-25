import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './lib/rate-limit.ts';
import { createTestApp, makeToken } from './test/setup.ts';

describe('createRateLimiter', () => {
  test('permite hasta el límite y después informa cuánto esperar', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000 }, () => t);
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a')).toEqual({ allowed: true });
    t = 2_500;
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSec: 8 });
    expect(limiter.hit('b')).toEqual({ allowed: true });
  });

  test('la ventana se reinicia y las claves vencidas se limpian', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 }, () => t);
    limiter.hit('a');
    limiter.hit('b');
    expect(limiter.hit('a').allowed).toBe(false);
    t = 1_000;
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.size()).toBe(1);
  });
});

describe('rate limit en endpoints', () => {
  test('unlock: 429 con Retry-After al pasar el límite, por usuario', async () => {
    const { app } = await createTestApp({ unlock: { limit: 2, windowMs: 60_000 } });
    const ana = await makeToken({ sub: 'rl-ana', email: 'ana@rl.com' });
    const beto = await makeToken({ sub: 'rl-beto', email: 'beto@rl.com' });
    const unlock = (token: string) =>
      app.request('/api/tools/meta-prompt-arquitecto/unlock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

    expect((await unlock(ana)).status).toBe(200);
    expect((await unlock(ana)).status).toBe(200);
    const blocked = await unlock(ana);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });

    expect((await unlock(beto)).status).toBe(200);
  });

  test('unlock sin auth: 401 sin consumir límite', async () => {
    const { app } = await createTestApp({ unlock: { limit: 1, windowMs: 60_000 } });
    const res = await app.request('/api/tools/meta-prompt-arquitecto/unlock', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('webhook: 429 por IP antes de validar la firma', async () => {
    const { app } = await createTestApp({ webhook: { limit: 1, windowMs: 60_000 } });
    const hit = (ip: string) =>
      app.request('/webhooks/mercadopago?data.id=1&type=payment', {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip },
      });

    expect((await hit('1.1.1.1')).status).toBe(401);
    expect((await hit('1.1.1.1')).status).toBe(429);
    expect((await hit('2.2.2.2')).status).toBe(401);
  });

  test('los endpoints de lectura no tienen límite', async () => {
    const { app } = await createTestApp({ unlock: { limit: 1, windowMs: 60_000 } });
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/api/tools')).status).toBe(200);
    }
  });
});

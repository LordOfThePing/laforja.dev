import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { tools, unlocks, users } from './db/schema.ts';
import { hasSubscriptionAccess } from './lib/access.ts';
import { monthKey } from './lib/month.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

function getMe(token?: string) {
  return app.request('/api/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

type MeResponse = {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  subscription: { status: string; currentPeriodEnd: string | null; hasAccess: boolean };
  unlocks: { monthKey: string; limit: number; used: number; remaining: number; tools: { slug: string }[] };
};

describe('auth', () => {
  test('sin token: 401', async () => {
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  test('header que no es Bearer: 401', async () => {
    const res = await app.request('/api/me', { headers: { Authorization: 'Basic abc' } });
    expect(res.status).toBe(401);
  });

  const invalid: [string, () => Promise<string>][] = [
    ['firma con otro secreto', () => makeToken({}, 'otro-secreto')],
    ['vencido', () => makeToken({ exp: Math.floor(Date.now() / 1000) - 10 })],
    ['sin exp', () => makeToken({ exp: undefined })],
    ['audiencia equivocada', () => makeToken({ aud: 'otra-app' })],
    ['sin sub', () => makeToken({ sub: undefined })],
    ['sin email', () => makeToken({ email: undefined })],
  ];
  for (const [name, token] of invalid) {
    test(`token inválido (${name}): 401`, async () => {
      const res = await getMe(await token());
      expect(res.status).toBe(401);
    });
  }

  test('token basura: 401', async () => {
    expect((await getMe('no-es-un-jwt')).status).toBe(401);
  });
});

describe('GET /api/me', () => {
  test('primer request: crea el usuario desde los claims', async () => {
    const res = await getMe(await makeToken());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;

    expect(body.user).toMatchObject({
      email: 'ana@example.com',
      name: 'Ana',
      avatarUrl: 'https://example.com/ana.png',
    });
    expect(body.subscription).toEqual({ status: 'none', currentPeriodEnd: null, hasAccess: false });
    expect(body.unlocks).toEqual({
      monthKey: monthKey(),
      limit: 2,
      used: 0,
      remaining: 2,
      tools: [],
    });
  });

  test('requests siguientes: mismo usuario, perfil actualizado', async () => {
    const first = (await (await getMe(await makeToken())).json()) as MeResponse;
    const second = (await (
      await getMe(await makeToken({ name: 'Ana María', email: 'ana.maria@example.com' }))
    ).json()) as MeResponse;

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.name).toBe('Ana María');
    expect(second.user.email).toBe('ana.maria@example.com');
    const rows = await db.select().from(users).where(eq(users.googleId, 'google-123'));
    expect(rows).toHaveLength(1);
  });

  test('cuenta solo los unlocks del mes en curso', async () => {
    const token = await makeToken({ sub: 'google-unlocks', email: 'beto@example.com' });
    const me = (await (await getMe(token)).json()) as MeResponse;
    const [t1, t2] = await db.select({ id: tools.id, slug: tools.slug }).from(tools).limit(2);
    if (!t1 || !t2) throw new Error('faltan herramientas del seed');

    await db.insert(unlocks).values([
      { userId: me.user.id, toolId: t1.id, monthKey: monthKey() },
      { userId: me.user.id, toolId: t2.id, monthKey: '2000-01' },
    ]);

    const body = (await (await getMe(token)).json()) as MeResponse;
    expect(body.unlocks.used).toBe(1);
    expect(body.unlocks.remaining).toBe(1);
    expect(body.unlocks.tools.map((t) => t.slug)).toEqual([t1.slug]);
  });

  test('suscripción activa: hasAccess', async () => {
    const token = await makeToken({ sub: 'google-sub', email: 'caro@example.com' });
    await getMe(token);
    const periodEnd = new Date(Date.now() + 86_400_000);
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', currentPeriodEnd: periodEnd })
      .where(eq(users.googleId, 'google-sub'));

    const body = (await (await getMe(token)).json()) as MeResponse;
    expect(body.subscription.status).toBe('active');
    expect(body.subscription.hasAccess).toBe(true);
    expect(body.subscription.currentPeriodEnd).toBe(periodEnd.toISOString());
  });
});

describe('hasSubscriptionAccess', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const future = new Date('2026-10-15T12:00:00Z');
  const past = new Date('2026-09-01T12:00:00Z');

  const cases: [string, Parameters<typeof hasSubscriptionAccess>[0], boolean][] = [
    ['none', { subscriptionStatus: 'none', currentPeriodEnd: null }, false],
    ['active sin fin', { subscriptionStatus: 'active', currentPeriodEnd: null }, true],
    ['active vigente', { subscriptionStatus: 'active', currentPeriodEnd: future }, true],
    ['active vencida', { subscriptionStatus: 'active', currentPeriodEnd: past }, false],
    ['cancelled con período pago', { subscriptionStatus: 'cancelled', currentPeriodEnd: future }, true],
    ['cancelled vencida', { subscriptionStatus: 'cancelled', currentPeriodEnd: past }, false],
    ['cancelled sin fin', { subscriptionStatus: 'cancelled', currentPeriodEnd: null }, false],
    ['paused', { subscriptionStatus: 'paused', currentPeriodEnd: future }, false],
  ];
  for (const [name, user, expected] of cases) {
    test(name, () => expect(hasSubscriptionAccess(user, now)).toBe(expected));
  }
});

describe('monthKey', () => {
  test('usa la hora de Argentina (UTC-3)', () => {
    expect(monthKey(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09');
    expect(monthKey(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10');
  });
});

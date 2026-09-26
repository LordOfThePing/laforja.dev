import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { subscriptionEvents, users } from './db/schema.ts';
import type { Preapproval } from './lib/mercadopago.ts';
import { reconcileSubscriptions } from './reconcile.ts';
import type { FakeMercadoPago } from './test/fake-mp.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let mp: FakeMercadoPago;

beforeAll(async () => {
  ({ app, db, mp } = await createTestApp());
});

// Levantar PGlite por test cuesta ~2 s; alcanza con volver a cero lo que la reconciliación mira.
beforeEach(async () => {
  mp.preapprovals.clear();
  mp.failNext = false;
  await db.delete(subscriptionEvents);
  await db.update(users).set({ subscriptionStatus: 'none', subscriptionId: null, currentPeriodEnd: null });
});

let userSeq = 0;
async function newUser() {
  userSeq += 1;
  const token = await makeToken({ sub: `google-r${userSeq}`, email: `r${userSeq}@example.com` });
  const res = await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  return ((await res.json()) as { user: { id: string } }).user.id;
}

async function getUser(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new Error('usuario inexistente');
  return user;
}

function preapproval(id: string, userId: string, status: Preapproval['status'], nextPayment: string | null) {
  mp.preapprovals.set(id, { id, status, external_reference: userId, next_payment_date: nextPayment });
}

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

describe('reconcileSubscriptions', () => {
  test('webhook authorized perdido: activa al usuario y deja el evento', async () => {
    const userId = await newUser();
    preapproval('pre-a', userId, 'authorized', '2026-11-01T00:00:00.000Z');

    const { changes } = await reconcileSubscriptions(db, mp);

    expect(changes).toHaveLength(1);
    const user = await getUser(userId);
    expect(user.subscriptionStatus).toBe('active');
    expect(user.subscriptionId).toBe('pre-a');
    expect(user.currentPeriodEnd?.getTime()).toBe(Date.parse('2026-11-01T00:00:00.000Z') + GRACE_MS);
    const events = await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.userId, userId));
    expect(events.map((e) => e.eventType)).toEqual(['reconciliation']);
  });

  test('renovación sin webhook: extiende current_period_end', async () => {
    const userId = await newUser();
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', subscriptionId: 'pre-b', currentPeriodEnd: new Date('2026-10-04T00:00:00.000Z') })
      .where(eq(users.id, userId));
    preapproval('pre-b', userId, 'authorized', '2026-11-01T00:00:00.000Z');

    await reconcileSubscriptions(db, mp);

    expect((await getUser(userId)).currentPeriodEnd?.getTime()).toBe(Date.parse('2026-11-01T00:00:00.000Z') + GRACE_MS);
  });

  test('MP pausó la suscripción vigente: la pausa', async () => {
    const userId = await newUser();
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', subscriptionId: 'pre-c' })
      .where(eq(users.id, userId));
    preapproval('pre-c', userId, 'paused', '2026-11-01T00:00:00.000Z');

    await reconcileSubscriptions(db, mp);

    expect((await getUser(userId)).subscriptionStatus).toBe('paused');
  });

  test('ya sincronizado: no cambia nada ni registra eventos, y es idempotente', async () => {
    const userId = await newUser();
    preapproval('pre-d', userId, 'authorized', '2026-11-01T00:00:00.000Z');

    expect((await reconcileSubscriptions(db, mp)).changes).toHaveLength(1);
    const second = await reconcileSubscriptions(db, mp);

    expect(second.checked).toBe(1);
    expect(second.changes).toHaveLength(0);
    expect(await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.userId, userId))).toHaveLength(1);
  });

  test('dry run: informa el cambio sin escribir', async () => {
    const userId = await newUser();
    preapproval('pre-e', userId, 'authorized', '2026-11-01T00:00:00.000Z');

    const { changes } = await reconcileSubscriptions(db, mp, { dryRun: true });

    expect(changes[0]?.after.subscriptionStatus).toBe('active');
    expect((await getUser(userId)).subscriptionStatus).toBe('none');
    expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
  });

  test('recorre todas las páginas de la búsqueda', async () => {
    for (let i = 0; i < 120; i += 1) {
      preapproval(`pre-ajena-${i}`, crypto.randomUUID(), 'authorized', '2026-11-01T00:00:00.000Z');
    }
    const userId = await newUser();
    preapproval('pre-ultima', userId, 'authorized', '2026-11-01T00:00:00.000Z');

    await reconcileSubscriptions(db, mp);

    expect((await getUser(userId)).subscriptionStatus).toBe('active');
  });

  test('una preapproval que MP no encuentra no frena al resto', async () => {
    const lost = await newUser();
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', subscriptionId: 'pre-inexistente' })
      .where(eq(users.id, lost));
    const paused = await newUser();
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', subscriptionId: 'pre-f' })
      .where(eq(users.id, paused));
    preapproval('pre-f', paused, 'paused', null);

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await reconcileSubscriptions(db, mp);
    } finally {
      console.warn = originalWarn;
    }

    expect((await getUser(lost)).subscriptionStatus).toBe('active');
    expect((await getUser(paused)).subscriptionStatus).toBe('paused');
  });

  test('MP caído: corta sin escribir nada', async () => {
    const userId = await newUser();
    preapproval('pre-g', userId, 'authorized', '2026-11-01T00:00:00.000Z');
    mp.failNext = true;

    await expect(reconcileSubscriptions(db, mp)).rejects.toThrow('falla simulada');
    expect((await getUser(userId)).subscriptionStatus).toBe('none');
  });

  test('una preapproval authorized vieja no pisa una más nueva del mismo usuario', async () => {
    const userId = await newUser();
    preapproval('pre-vieja', userId, 'authorized', '2026-10-01T00:00:00.000Z');
    preapproval('pre-nueva', userId, 'authorized', '2026-11-01T00:00:00.000Z');

    await reconcileSubscriptions(db, mp);

    expect((await getUser(userId)).subscriptionId).toBe('pre-nueva');
  });
});

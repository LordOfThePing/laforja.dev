import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { subscriptionEvents, users } from './db/schema.ts';
import { buildManifest, signManifest, verifyMpSignature } from './lib/mp-signature.ts';
import type { FakeMercadoPago } from './test/fake-mp.ts';
import { TEST_MP_WEBHOOK_SECRET, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let mp: FakeMercadoPago;

beforeAll(async () => {
  ({ app, db, mp } = await createTestApp());
});

beforeEach(() => {
  mp.failNext = false;
});

let userSeq = 0;
async function newUser() {
  userSeq += 1;
  const token = await makeToken({ sub: `google-s${userSeq}`, email: `s${userSeq}@example.com` });
  const res = await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  const me = (await res.json()) as { user: { id: string } };
  return { token, id: me.user.id };
}

function post(path: string, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function getUser(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new Error('usuario inexistente');
  return user;
}

let notificationSeq = 1000;
function webhook(
  type: string,
  dataId: string,
  opts: { secret?: string; notificationId?: number; tamperId?: string } = {},
) {
  const notificationId = opts.notificationId ?? ++notificationSeq;
  const requestId = `req-${notificationId}`;
  const ts = String(Date.now());
  const signature = signManifest(opts.secret ?? TEST_MP_WEBHOOK_SECRET, buildManifest(dataId, requestId, ts));
  const queryId = opts.tamperId ?? dataId;
  return app.request(`/webhooks/mercadopago?data.id=${queryId}&type=${type}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': `ts=${ts},v1=${signature}`,
      'x-request-id': requestId,
    },
    body: JSON.stringify({ id: notificationId, type, action: 'updated', data: { id: dataId } }),
  });
}

async function subscribe(userId: string, token: string, nextPayment = '2026-10-25T12:00:00.000Z') {
  const res = await post('/api/subscription/create', token);
  const { preapprovalId } = (await res.json()) as { preapprovalId: string };
  const pre = mp.preapprovals.get(preapprovalId);
  if (!pre) throw new Error('preapproval inexistente');
  pre.status = 'authorized';
  pre.next_payment_date = nextPayment;
  expect((await webhook('subscription_preapproval', preapprovalId)).status).toBe(200);
  expect((await getUser(userId)).subscriptionStatus).toBe('active');
  return preapprovalId;
}

describe('POST /api/subscription/create', () => {
  test('sin auth: 401', async () => {
    expect((await post('/api/subscription/create')).status).toBe(401);
  });

  test('crea la preapproval y devuelve init_point', async () => {
    const { token, id } = await newUser();
    const res = await post('/api/subscription/create', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { initPoint: string; preapprovalId: string };
    expect(body.initPoint).toStartWith('https://mp.test/checkout/');
    expect(mp.created.at(-1)).toEqual({
      reason: 'La Forja — Suscripción mensual',
      amount: 4000,
      payerEmail: `s${userSeq}@example.com`,
      externalReference: id,
      backUrl: 'http://localhost:3000/dashboard/gracias',
    });
  });

  test('ya suscripto: 409', async () => {
    const { token, id } = await newUser();
    await subscribe(id, token);
    expect((await post('/api/subscription/create', token)).status).toBe(409);
  });

  test('MP caído: 502', async () => {
    const { token } = await newUser();
    mp.failNext = true;
    const res = await post('/api/subscription/create', token);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'payment_provider_error' });
  });
});

describe('webhook subscription_preapproval', () => {
  test('authorized: activa al usuario con período + 3 días de gracia', async () => {
    const { token, id } = await newUser();
    const preId = await subscribe(id, token, '2026-10-25T12:00:00.000Z');
    const user = await getUser(id);
    expect(user.subscriptionId).toBe(preId);
    expect(user.currentPeriodEnd?.toISOString()).toBe('2026-10-28T12:00:00.000Z');

    const [event] = await db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.userId, id));
    expect(event?.eventType).toBe('subscription_preapproval');
  });

  test('firma inválida: 401 y no toca nada', async () => {
    const { token, id } = await newUser();
    const res = await post('/api/subscription/create', token);
    const { preapprovalId } = (await res.json()) as { preapprovalId: string };
    const pre = mp.preapprovals.get(preapprovalId);
    if (pre) pre.status = 'authorized';

    expect((await webhook('subscription_preapproval', preapprovalId, { secret: 'otro' })).status).toBe(401);
    expect((await getUser(id)).subscriptionStatus).toBe('none');
  });

  test('data.id del query distinto al firmado: 401', async () => {
    const { token } = await newUser();
    const res = await post('/api/subscription/create', token);
    const { preapprovalId } = (await res.json()) as { preapprovalId: string };
    const status = (await webhook('subscription_preapproval', preapprovalId, { tamperId: 'pre-otro' })).status;
    expect(status).toBe(401);
  });

  test('notificación repetida: se procesa una sola vez', async () => {
    const { token, id } = await newUser();
    const preId = await subscribe(id, token);
    const pre = mp.preapprovals.get(preId);
    if (!pre) throw new Error('preapproval inexistente');
    pre.status = 'paused';

    const first = await webhook('subscription_preapproval', preId, { notificationId: 555_001 });
    expect(await first.json()).toEqual({ status: 'processed' });
    await db.update(users).set({ subscriptionStatus: 'active' }).where(eq(users.id, id));

    const again = await webhook('subscription_preapproval', preId, { notificationId: 555_001 });
    expect(await again.json()).toEqual({ status: 'duplicate' });
    expect((await getUser(id)).subscriptionStatus).toBe('active');
  });

  test('cancelar una preapproval vieja no toca la suscripción vigente', async () => {
    const { token, id } = await newUser();
    const oldRes = await post('/api/subscription/create', token);
    const { preapprovalId: oldId } = (await oldRes.json()) as { preapprovalId: string };
    await subscribe(id, token);

    const old = mp.preapprovals.get(oldId);
    if (!old) throw new Error('preapproval inexistente');
    old.status = 'cancelled';
    await webhook('subscription_preapproval', oldId);
    expect((await getUser(id)).subscriptionStatus).toBe('active');
  });

  test('MP falla al consultar: 502 y el reintento procesa', async () => {
    const { token, id } = await newUser();
    const res = await post('/api/subscription/create', token);
    const { preapprovalId } = (await res.json()) as { preapprovalId: string };
    const pre = mp.preapprovals.get(preapprovalId);
    if (!pre) throw new Error('preapproval inexistente');
    pre.status = 'authorized';

    mp.failNext = true;
    expect((await webhook('subscription_preapproval', preapprovalId, { notificationId: 777_001 })).status).toBe(502);
    expect((await getUser(id)).subscriptionStatus).toBe('none');

    expect((await webhook('subscription_preapproval', preapprovalId, { notificationId: 777_001 })).status).toBe(200);
    expect((await getUser(id)).subscriptionStatus).toBe('active');
  });

  test('external_reference de un usuario inexistente: 200, evento guardado sin usuario', async () => {
    mp.preapprovals.set('pre-huerfana', {
      id: 'pre-huerfana',
      status: 'authorized',
      external_reference: '00000000-0000-4000-8000-000000000000',
      next_payment_date: null,
    });
    const res = await webhook('subscription_preapproval', 'pre-huerfana');
    expect(res.status).toBe(200);
  });

  test('tipo desconocido: se guarda y responde 200', async () => {
    const res = await webhook('payment', '999');
    expect(await res.json()).toEqual({ status: 'processed' });
  });
});

describe('webhook subscription_authorized_payment', () => {
  test('cobro aprobado: renueva current_period_end', async () => {
    const { token, id } = await newUser();
    const preId = await subscribe(id, token, '2026-10-25T12:00:00.000Z');
    const pre = mp.preapprovals.get(preId);
    if (!pre) throw new Error('preapproval inexistente');
    pre.next_payment_date = '2026-11-25T12:00:00.000Z';
    mp.authorizedPayments.set(`ap-${id}`, {
      id: `ap-${id}`,
      preapproval_id: preId,
      status: 'processed',
      payment: { id: 1, status: 'approved' },
    });

    expect((await webhook('subscription_authorized_payment', `ap-${id}`)).status).toBe(200);
    const user = await getUser(id);
    expect(user.subscriptionStatus).toBe('active');
    expect(user.currentPeriodEnd?.toISOString()).toBe('2026-11-28T12:00:00.000Z');
  });

  test('cobro rechazado: pausa la suscripción', async () => {
    const { token, id } = await newUser();
    const preId = await subscribe(id, token);
    mp.authorizedPayments.set(`ap-${id}`, {
      id: `ap-${id}`,
      preapproval_id: preId,
      status: 'recycling',
      payment: { id: 2, status: 'rejected' },
    });

    await webhook('subscription_authorized_payment', `ap-${id}`);
    expect((await getUser(id)).subscriptionStatus).toBe('paused');
  });
});

describe('POST /api/subscription/cancel', () => {
  test('sin suscripción: 409', async () => {
    const { token } = await newUser();
    expect((await post('/api/subscription/cancel', token)).status).toBe(409);
  });

  test('cancela en MP y conserva el período pago', async () => {
    const { token, id } = await newUser();
    const preId = await subscribe(id, token, '2099-01-01T00:00:00.000Z');
    const res = await post('/api/subscription/cancel', token);
    expect(res.status).toBe(200);
    expect(mp.cancelled).toContain(preId);

    const user = await getUser(id);
    expect(user.subscriptionStatus).toBe('cancelled');
    expect(user.currentPeriodEnd?.toISOString()).toBe('2099-01-04T00:00:00.000Z');

    const me = await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const body = (await me.json()) as { subscription: { hasAccess: boolean } };
    expect(body.subscription.hasAccess).toBe(true);
  });
});

describe('verifyMpSignature', () => {
  const secret = 'abc';
  const ts = '1742505638683';
  const reqId = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e';

  test('manifest con el formato documentado, data.id en minúsculas', () => {
    expect(buildManifest('ABC123', reqId, ts)).toBe(`id:abc123;request-id:${reqId};ts:${ts};`);
    expect(buildManifest(undefined, undefined, ts)).toBe(`ts:${ts};`);
  });

  test('acepta firma válida con espacios en el header', () => {
    const v1 = signManifest(secret, buildManifest('123', reqId, ts));
    expect(
      verifyMpSignature({ secret, xSignature: `ts=${ts}, v1=${v1}`, xRequestId: reqId, dataId: '123' }),
    ).toBe(true);
  });

  test('rechaza header ausente, incompleto o con otra firma', () => {
    const base = { secret, xRequestId: reqId, dataId: '123' };
    expect(verifyMpSignature({ ...base, xSignature: undefined })).toBe(false);
    expect(verifyMpSignature({ ...base, xSignature: `ts=${ts}` })).toBe(false);
    expect(verifyMpSignature({ ...base, xSignature: `ts=${ts},v1=deadbeef` })).toBe(false);
  });
});

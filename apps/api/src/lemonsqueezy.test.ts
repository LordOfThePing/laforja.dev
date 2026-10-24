import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { subscriptionEvents, users } from './db/schema.ts';
import { verifyLemonSignature } from './lib/lemonsqueezy.ts';
import { variantPlans } from './lib/lemonsqueezy-sync.ts';
import { reconcileLemonSubscriptions } from './reconcile.ts';
import { type FakeLemonSqueezy, TEST_LS_VARIANTS } from './test/fake-lemonsqueezy.ts';
import type { FakeMercadoPago } from './test/fake-mp.ts';
import { TEST_LS_WEBHOOK_SECRET, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let mp: FakeMercadoPago;
let lemon: FakeLemonSqueezy;
const plans = variantPlans(TEST_LS_VARIANTS);

beforeAll(async () => {
  const created = await createTestApp(undefined, undefined, undefined, { lemon: true });
  ({ app, db, mp } = created);
  lemon = created.lemon!;
});

beforeEach(() => {
  lemon.failNext = false;
});

let userSeq = 0;
async function newUser() {
  userSeq += 1;
  const email = `ls${userSeq}@example.com`;
  const token = await makeToken({ sub: `google-ls${userSeq}`, email });
  const res = await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  const me = (await res.json()) as { user: { id: string } };
  return { token, id: me.user.id, email };
}

function post(path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function getUser(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new Error('usuario inexistente');
  return user;
}

const sign = (payload: string, secret = TEST_LS_WEBHOOK_SECRET) =>
  createHmac('sha256', secret).update(payload).digest('hex');

let eventSeq = 0;
function webhook(
  eventName: string,
  subscriptionId: string,
  custom: Record<string, unknown> | null,
  opts: { signature?: string; payload?: string } = {},
) {
  // event_seq hace distinto cada body, como los updated_at de LS en eventos reales.
  const payload =
    opts.payload ??
    JSON.stringify({
      meta: { event_name: eventName, custom_data: custom ?? undefined, event_seq: ++eventSeq },
      data: { type: 'subscriptions', id: subscriptionId, attributes: {} },
    });
  return app.request('/webhooks/lemonsqueezy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': opts.signature ?? sign(payload) },
    body: payload,
  });
}

async function checkout(token: string, plan: 'basic' | 'pro' = 'pro') {
  const res = await post('/api/subscription/create', token, { plan, provider: 'lemonsqueezy' });
  expect(res.status).toBe(200);
  return (await res.json()) as { initPoint: string; checkoutId: string; plan: string; provider: string };
}

async function subscribe(id: string, token: string, plan: 'basic' | 'pro' = 'pro') {
  const { checkoutId } = await checkout(token, plan);
  const sub = lemon.complete(checkoutId);
  const res = await webhook('subscription_created', sub.id, { user_id: id, plan });
  expect(await res.json()).toEqual({ status: 'processed' });
  expect((await getUser(id)).subscriptionStatus).toBe('active');
  return sub;
}

describe('POST /api/subscription/create con provider lemonsqueezy', () => {
  test('crea el checkout con la variant del plan, el monto USD de plan_prices y el usuario en custom', async () => {
    const { token, id, email } = await newUser();
    const body = await checkout(token, 'basic');
    expect(body.provider).toBe('lemonsqueezy');
    expect(body.initPoint).toStartWith('https://laforja.lemonsqueezy.test/checkout/');
    expect(lemon.checkouts.at(-1)).toMatchObject({
      variantId: TEST_LS_VARIANTS.basic,
      customPrice: 700,
      email,
      userId: id,
      plan: 'basic',
      redirectUrl: 'http://localhost:3000/dashboard/gracias?provider=lemonsqueezy',
    });
  });

  test('provider inválido: 400', async () => {
    const { token } = await newUser();
    const res = await post('/api/subscription/create', token, { plan: 'pro', provider: 'stripe' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_provider' });
  });

  test('Lemon Squeezy caído: 502', async () => {
    const { token } = await newUser();
    lemon.failNext = true;
    const res = await post('/api/subscription/create', token, { plan: 'pro', provider: 'lemonsqueezy' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'payment_provider_error' });
  });

  test('sin Lemon Squeezy configurado: 503 provider_disabled y sin webhook', async () => {
    const { app: plain } = await createTestApp();
    const token = await makeToken({ sub: 'google-sin-ls', email: 'sin-ls@example.com' });
    const res = await plain.request('/api/subscription/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', provider: 'lemonsqueezy' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'provider_disabled' });
    expect((await plain.request('/webhooks/lemonsqueezy', { method: 'POST', body: '{}' })).status).toBe(404);
    expect(await (await plain.request('/api/prices')).json()).toMatchObject({
      providers: { mercadopago: true, lemonsqueezy: false },
    });
  });
});

describe('webhook /webhooks/lemonsqueezy', () => {
  test('subscription_created: activa con plan, provider, ids y renovación', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token, 'basic');
    const user = await getUser(id);
    expect(user).toMatchObject({
      subscriptionStatus: 'active',
      subscriptionPlan: 'basic',
      paymentProvider: 'lemonsqueezy',
      lsSubscriptionId: sub.id,
      lsCustomerId: sub.customerId,
    });
    expect(user.currentPeriodEnd?.toISOString()).toBe('2099-01-01T00:00:00.000Z');

    const [event] = await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.userId, id));
    expect(event?.eventType).toBe('subscription_created');
    expect(event?.providerEventId).toStartWith('ls:');
  });

  test('el plan sale de la variant aunque el custom_data diga otra cosa', async () => {
    const { token, id } = await newUser();
    const { checkoutId } = await checkout(token, 'pro');
    const sub = lemon.complete(checkoutId);
    await webhook('subscription_created', sub.id, { user_id: id, plan: 'basic' });
    expect((await getUser(id)).subscriptionPlan).toBe('pro');
  });

  test('firma inválida: 401 y no toca nada', async () => {
    const { token, id } = await newUser();
    const { checkoutId } = await checkout(token);
    const sub = lemon.complete(checkoutId);
    const res = await webhook('subscription_created', sub.id, { user_id: id }, { signature: sign('otro', 'otro-secreto') });
    expect(res.status).toBe(401);
    expect((await getUser(id)).subscriptionStatus).toBe('none');
  });

  test('reintento con el mismo body: se procesa una sola vez', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    const payload = JSON.stringify({
      meta: { event_name: 'subscription_updated', custom_data: { user_id: id } },
      data: { type: 'subscriptions', id: sub.id },
    });
    expect(await (await webhook('', sub.id, null, { payload })).json()).toEqual({ status: 'processed' });
    expect(await (await webhook('', sub.id, null, { payload })).json()).toEqual({ status: 'duplicate' });
  });

  test('subscription_cancelled: cancelada con acceso hasta ends_at', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    Object.assign(lemon.subscriptions.get(sub.id)!, { status: 'cancelled', endsAt: '2099-02-01T00:00:00.000Z' });
    await webhook('subscription_cancelled', sub.id, { user_id: id });
    const user = await getUser(id);
    expect(user.subscriptionStatus).toBe('cancelled');
    expect(user.currentPeriodEnd?.toISOString()).toBe('2099-02-01T00:00:00.000Z');
  });

  test('past_due: pausa', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    lemon.subscriptions.get(sub.id)!.status = 'past_due';
    await webhook('subscription_updated', sub.id, { user_id: id });
    expect((await getUser(id)).subscriptionStatus).toBe('paused');
  });

  test('bajar una suscripción vieja no pisa la vigente', async () => {
    const { token, id } = await newUser();
    const old = await subscribe(id, token);
    await db.update(users).set({ subscriptionStatus: 'none' }).where(eq(users.id, id));
    const current = await subscribe(id, token);
    lemon.subscriptions.get(old.id)!.status = 'expired';
    await webhook('subscription_expired', old.id, { user_id: id });
    expect(await getUser(id)).toMatchObject({ subscriptionStatus: 'active', lsSubscriptionId: current.id });
  });

  test('eventos que no son de suscripción: se guardan y no tocan al usuario', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    lemon.subscriptions.get(sub.id)!.status = 'expired';
    const payload = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: id } },
      data: { type: 'orders', id: '77' },
    });
    expect(await (await webhook('', '', null, { payload })).json()).toEqual({ status: 'processed' });
    expect((await getUser(id)).subscriptionStatus).toBe('active');
  });

  test('LS falla al traer la suscripción: 502 y el reintento procesa', async () => {
    const { token, id } = await newUser();
    const { checkoutId } = await checkout(token);
    const sub = lemon.complete(checkoutId);
    const payload = JSON.stringify({
      meta: { event_name: 'subscription_created', custom_data: { user_id: id, plan: 'pro' } },
      data: { type: 'subscriptions', id: sub.id },
    });
    lemon.failNext = true;
    expect((await webhook('', '', null, { payload })).status).toBe(502);
    expect((await webhook('', '', null, { payload })).status).toBe(200);
    expect((await getUser(id)).subscriptionStatus).toBe('active');
  });
});

describe('POST /api/subscription/cancel con Lemon Squeezy', () => {
  test('cancela en LS, no en MP, y conserva el período pago', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    const cancelledInMp = mp.cancelled.length;
    const res = await post('/api/subscription/cancel', token);
    expect(res.status).toBe(200);
    expect(lemon.cancelled).toContain(sub.id);
    expect(mp.cancelled.length).toBe(cancelledInMp);
    const user = await getUser(id);
    expect(user.subscriptionStatus).toBe('cancelled');
    expect(user.currentPeriodEnd?.toISOString()).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('reconcileLemonSubscriptions', () => {
  test('primer webhook perdido: vincula por email y toma el plan de la variant', async () => {
    const { token, id } = await newUser();
    const { checkoutId } = await checkout(token, 'basic');
    const sub = lemon.complete(checkoutId);
    expect((await getUser(id)).subscriptionStatus).toBe('none');

    const { changes } = await reconcileLemonSubscriptions(db, lemon, plans);
    expect(changes.some((c) => c.userId === id)).toBe(true);
    expect(await getUser(id)).toMatchObject({
      subscriptionStatus: 'active',
      subscriptionPlan: 'basic',
      paymentProvider: 'lemonsqueezy',
      lsSubscriptionId: sub.id,
    });
  });

  test('baja una que LS venció sin avisar', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    Object.assign(lemon.subscriptions.get(sub.id)!, { status: 'expired', endsAt: '2020-01-01T00:00:00.000Z' });
    await reconcileLemonSubscriptions(db, lemon, plans);
    const user = await getUser(id);
    expect(user.subscriptionStatus).toBe('cancelled');
    expect(user.currentPeriodEnd?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  test('dry run no escribe', async () => {
    const { token, id } = await newUser();
    const { checkoutId } = await checkout(token);
    lemon.complete(checkoutId);
    const { changes } = await reconcileLemonSubscriptions(db, lemon, plans, { dryRun: true });
    expect(changes.some((c) => c.userId === id)).toBe(true);
    expect((await getUser(id)).subscriptionStatus).toBe('none');
  });
});

describe('verifyLemonSignature', () => {
  const payload = '{"meta":{"event_name":"subscription_created"}}';

  test('acepta la firma correcta', () => {
    expect(verifyLemonSignature({ secret: 's', header: sign(payload, 's'), payload })).toBe(true);
  });

  test('rechaza header ausente, otro secreto o body alterado', () => {
    expect(verifyLemonSignature({ secret: 's', header: undefined, payload })).toBe(false);
    expect(verifyLemonSignature({ secret: 's', header: sign(payload, 'otro'), payload })).toBe(false);
    expect(verifyLemonSignature({ secret: 's', header: sign(payload, 's'), payload: `${payload} ` })).toBe(false);
  });
});

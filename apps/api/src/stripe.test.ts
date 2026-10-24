import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { subscriptionEvents, users } from './db/schema.ts';
import { verifyStripeSignature } from './lib/stripe.ts';
import { reconcileStripeSubscriptions } from './reconcile.ts';
import type { FakeMercadoPago } from './test/fake-mp.ts';
import type { FakeStripe } from './test/fake-stripe.ts';
import { TEST_STRIPE_WEBHOOK_SECRET, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let mp: FakeMercadoPago;
let stripe: FakeStripe;

beforeAll(async () => {
  const created = await createTestApp(undefined, undefined, undefined, { stripe: true });
  ({ app, db, mp } = created);
  stripe = created.stripe!;
});

beforeEach(() => {
  stripe.failNext = false;
});

let userSeq = 0;
async function newUser() {
  userSeq += 1;
  const token = await makeToken({ sub: `google-st${userSeq}`, email: `st${userSeq}@example.com` });
  const res = await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  const me = (await res.json()) as { user: { id: string } };
  return { token, id: me.user.id };
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

function sign(payload: string, secret = TEST_STRIPE_WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

let eventSeq = 0;
function webhook(type: string, object: unknown, opts: { id?: string; signature?: string } = {}) {
  const payload = JSON.stringify({ id: opts.id ?? `evt_${++eventSeq}`, type, data: { object } });
  return app.request('/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': opts.signature ?? sign(payload) },
    body: payload,
  });
}

async function checkout(token: string, plan: 'basic' | 'pro' = 'pro') {
  const res = await post('/api/subscription/create', token, { plan, provider: 'stripe' });
  expect(res.status).toBe(200);
  return (await res.json()) as { initPoint: string; sessionId: string; plan: string; provider: string };
}

async function subscribe(id: string, token: string, plan: 'basic' | 'pro' = 'pro') {
  const { sessionId } = await checkout(token, plan);
  const sub = stripe.complete(sessionId);
  const res = await webhook('checkout.session.completed', { id: sessionId, mode: 'subscription', subscription: sub.id });
  expect(res.status).toBe(200);
  expect((await getUser(id)).subscriptionStatus).toBe('active');
  return sub;
}

describe('POST /api/subscription/create con provider stripe', () => {
  test('crea la session con el monto USD de plan_prices y el plan en la metadata', async () => {
    const { token, id } = await newUser();
    const body = await checkout(token, 'basic');
    expect(body.provider).toBe('stripe');
    expect(body.initPoint).toStartWith('https://stripe.test/checkout/');
    expect(stripe.checkouts.at(-1)).toMatchObject({
      plan: 'basic',
      amount: 700,
      currency: 'USD',
      userId: id,
      successUrl: 'http://localhost:3000/dashboard/gracias?stripe_session={CHECKOUT_SESSION_ID}',
      cancelUrl: 'http://localhost:3000/suscripcion',
    });
  });

  test('reusa el customer entre altas', async () => {
    const { token, id } = await newUser();
    await checkout(token);
    const customerId = (await getUser(id)).stripeCustomerId;
    expect(customerId).toStartWith('cus_');
    const before = stripe.customers.length;
    await checkout(token);
    expect(stripe.customers.length).toBe(before);
    expect(stripe.checkouts.at(-1)?.customerId).toBe(customerId!);
  });

  test('provider inválido: 400', async () => {
    const { token } = await newUser();
    const res = await post('/api/subscription/create', token, { plan: 'pro', provider: 'paypal' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_provider' });
  });

  test('Stripe caído: 502', async () => {
    const { token } = await newUser();
    stripe.failNext = true;
    const res = await post('/api/subscription/create', token, { plan: 'pro', provider: 'stripe' });
    expect(res.status).toBe(502);
  });

  test('sin Stripe configurado: 503 provider_disabled', async () => {
    const { app: plain } = await createTestApp();
    const token = await makeToken({ sub: 'google-sin-stripe', email: 'sin-stripe@example.com' });
    const res = await plain.request('/api/subscription/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', provider: 'stripe' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'provider_disabled' });
    expect((await plain.request('/webhooks/stripe', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});

describe('webhook /webhooks/stripe', () => {
  test('checkout.session.completed: activa con plan, provider y período', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token, 'basic');
    const user = await getUser(id);
    expect(user).toMatchObject({
      subscriptionStatus: 'active',
      subscriptionPlan: 'basic',
      paymentProvider: 'stripe',
      stripeSubscriptionId: sub.id,
    });
    expect(user.currentPeriodEnd?.toISOString()).toBe('2099-01-01T00:00:00.000Z');

    const [event] = await db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.eventType, 'checkout.session.completed'))
      .orderBy(subscriptionEvents.receivedAt)
      .limit(1);
    expect(event?.providerEventId).toStartWith('stripe:evt_');
  });

  test('firma inválida: 401 y no toca nada', async () => {
    const { token, id } = await newUser();
    const { sessionId } = await checkout(token);
    const sub = stripe.complete(sessionId);
    const payload = JSON.stringify({ id: 'evt_x', type: 'customer.subscription.updated', data: { object: sub } });
    const res = await webhook('customer.subscription.updated', sub, { signature: sign(payload, 'otro-secreto') });
    expect(res.status).toBe(401);
    expect((await getUser(id)).subscriptionStatus).toBe('none');
  });

  test('evento repetido: se procesa una sola vez', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    const first = await webhook('customer.subscription.updated', sub, { id: 'evt_repetido' });
    expect(await first.json()).toEqual({ status: 'processed' });
    const second = await webhook('customer.subscription.updated', sub, { id: 'evt_repetido' });
    expect(await second.json()).toEqual({ status: 'duplicate' });
  });

  test('subscription.deleted: cancela la vigente', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    sub.status = 'canceled';
    expect((await webhook('customer.subscription.deleted', sub)).status).toBe(200);
    expect((await getUser(id)).subscriptionStatus).toBe('cancelled');
  });

  test('past_due: pausa', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    sub.status = 'past_due';
    await webhook('customer.subscription.updated', sub);
    expect((await getUser(id)).subscriptionStatus).toBe('paused');
  });

  test('Stripe falla al traer la subscription: 500 y el reintento procesa', async () => {
    const { token, id } = await newUser();
    const { sessionId } = await checkout(token);
    const sub = stripe.complete(sessionId);
    const object = { id: sessionId, mode: 'subscription', subscription: sub.id };
    stripe.failNext = true;
    expect((await webhook('checkout.session.completed', object, { id: 'evt_reintento' })).status).toBe(502);
    expect((await webhook('checkout.session.completed', object, { id: 'evt_reintento' })).status).toBe(200);
    expect((await getUser(id)).subscriptionStatus).toBe('active');
  });
});

describe('POST /api/subscription/cancel con Stripe', () => {
  test('cancela al final del período en Stripe, no en MP', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    const cancelledInMp = mp.cancelled.length;
    const res = await post('/api/subscription/cancel', token);
    expect(res.status).toBe(200);
    expect(stripe.subscriptions.get(sub.id)?.cancel_at_period_end).toBe(true);
    expect(mp.cancelled.length).toBe(cancelledInMp);
    const user = await getUser(id);
    expect(user.subscriptionStatus).toBe('cancelled');
    expect(user.currentPeriodEnd?.toISOString()).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('reconcileStripeSubscriptions', () => {
  test('aplica una subscription activa cuyo webhook se perdió', async () => {
    const { token, id } = await newUser();
    const { sessionId } = await checkout(token, 'basic');
    stripe.complete(sessionId);
    expect((await getUser(id)).subscriptionStatus).toBe('none');

    const { changes } = await reconcileStripeSubscriptions(db, stripe);
    expect(changes.some((c) => c.userId === id)).toBe(true);
    expect(await getUser(id)).toMatchObject({ subscriptionStatus: 'active', subscriptionPlan: 'basic' });
  });

  test('baja una que Stripe canceló sin avisar', async () => {
    const { token, id } = await newUser();
    const sub = await subscribe(id, token);
    sub.status = 'canceled';
    await reconcileStripeSubscriptions(db, stripe);
    expect((await getUser(id)).subscriptionStatus).toBe('cancelled');
  });

  test('dry run no escribe', async () => {
    const { token, id } = await newUser();
    const { sessionId } = await checkout(token);
    stripe.complete(sessionId);
    const { changes } = await reconcileStripeSubscriptions(db, stripe, { dryRun: true });
    expect(changes.some((c) => c.userId === id)).toBe(true);
    expect((await getUser(id)).subscriptionStatus).toBe('none');
  });
});

describe('verifyStripeSignature', () => {
  const payload = '{"id":"evt_1"}';

  test('acepta una firma válida entre varias v1', async () => {
    const ts = 1_800_000_000;
    const header = `t=${ts},v1=deadbeef,${sign(payload, 's', ts).split(',')[1]}`;
    expect(await verifyStripeSignature({ secret: 's', header, payload, nowSeconds: ts })).toBe(true);
  });

  test('rechaza timestamps fuera de tolerancia, header ausente o body alterado', async () => {
    const ts = 1_800_000_000;
    const header = sign(payload, 's', ts);
    expect(await verifyStripeSignature({ secret: 's', header, payload, nowSeconds: ts + 301 })).toBe(false);
    expect(await verifyStripeSignature({ secret: 's', header: undefined, payload, nowSeconds: ts })).toBe(false);
    expect(await verifyStripeSignature({ secret: 's', header, payload: '{"id":"evt_2"}', nowSeconds: ts })).toBe(false);
  });
});

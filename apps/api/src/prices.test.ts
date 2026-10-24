import { beforeAll, describe, expect, test } from 'bun:test';
import type { createApp } from './app.ts';
import { planFromPreapproval } from './routes/subscription.ts';
import type { FakeMercadoPago } from './test/fake-mp.ts';
import type { FakeStripe } from './test/fake-stripe.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let mp: FakeMercadoPago;
let stripe: FakeStripe;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  const created = await createTestApp(undefined, undefined, undefined, { stripe: true });
  ({ app, mp } = created);
  stripe = created.stripe!;
  adminToken = await makeToken({ sub: 'google-admin-precios', email: 'admin@example.com' });
  userToken = await makeToken({ sub: 'google-comun-precios', email: 'comun-precios@example.com' });
});

function req(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe('GET /api/prices', () => {
  test('público: devuelve los montos de la migración y los providers activos', async () => {
    const res = await req('GET', '/api/prices');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      prices: { basic: { ARS: 699900, USD: 700 }, pro: { ARS: 1999900, USD: 2000 } },
      providers: { mercadopago: true, stripe: true },
    });
  });
});

describe('/api/admin/prices', () => {
  test('sin admin: 404, como el resto del panel', async () => {
    expect((await req('GET', '/api/admin/prices', userToken)).status).toBe(404);
    expect((await req('PUT', '/api/admin/prices', userToken, { prices: [] })).status).toBe(404);
  });

  test.each([
    [{}],
    [{ prices: [] }],
    [{ prices: [{ plan: 'gold', currency: 'ARS', amount: 100 }] }],
    [{ prices: [{ plan: 'pro', currency: 'EUR', amount: 100 }] }],
    [{ prices: [{ plan: 'pro', currency: 'USD', amount: 0 }] }],
    [{ prices: [{ plan: 'pro', currency: 'USD', amount: 12.5 }] }],
    [{ prices: [{ plan: 'pro', currency: 'USD', amount: 1_000_000_000 }] }],
  ])('input inválido %j: 400', async (body) => {
    const res = await req('PUT', '/api/admin/prices', adminToken, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input', field: 'prices' });
  });

  test('cambiar precios: las altas nuevas cobran el monto nuevo en cada provider', async () => {
    const res = await req('PUT', '/api/admin/prices', adminToken, {
      prices: [
        { plan: 'pro', currency: 'ARS', amount: 2499950 },
        { plan: 'pro', currency: 'USD', amount: 2499 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      prices: { basic: { ARS: 699900, USD: 700 }, pro: { ARS: 2499950, USD: 2499 } },
    });

    const buyer = await makeToken({ sub: 'google-comprador', email: 'comprador@example.com' });
    expect((await req('POST', '/api/subscription/create', buyer, { plan: 'pro' })).status).toBe(200);
    expect(mp.created.at(-1)).toMatchObject({ reason: 'La Forja — Suscripción Maestro', amount: 24999.5 });

    expect((await req('POST', '/api/subscription/create', buyer, { plan: 'pro', provider: 'stripe' })).status).toBe(200);
    expect(stripe.checkouts.at(-1)).toMatchObject({ plan: 'pro', amount: 2499, currency: 'USD' });
  });
});

describe('planFromPreapproval', () => {
  test('reconoce el plan por reason, sin importar el monto', () => {
    expect(planFromPreapproval({ reason: 'La Forja — Suscripción Oficial', auto_recurring: { transaction_amount: 1 } })).toBe('basic');
    expect(planFromPreapproval({ reason: 'La Forja — Suscripción Maestro', auto_recurring: { transaction_amount: 1 } })).toBe('pro');
  });

  test('preapprovals viejas sin reason conocido: por los montos de antes de plan_prices', () => {
    expect(planFromPreapproval({ reason: 'otra cosa', auto_recurring: { transaction_amount: 6999 } })).toBe('basic');
    expect(planFromPreapproval({ auto_recurring: { transaction_amount: 19999 } })).toBe('pro');
    expect(planFromPreapproval({ auto_recurring: { transaction_amount: 4000 } })).toBeNull();
  });
});

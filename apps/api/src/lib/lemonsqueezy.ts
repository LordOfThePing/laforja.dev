import { createHmac, timingSafeEqual } from 'node:crypto';

const LS_API = 'https://api.lemonsqueezy.com/v1';

// https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object
export type LemonSubscriptionStatus =
  | 'on_trial'
  | 'active'
  | 'paused'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'expired';

export type LemonSubscription = {
  id: string;
  status: LemonSubscriptionStatus;
  customerId: string;
  variantId: string;
  userEmail: string | null;
  renewsAt: string | null;
  endsAt: string | null;
};

export type LemonSubscriptionPage = { data: LemonSubscription[]; lastPage: number };

export type CreateCheckoutInput = {
  variantId: string;
  // En centavos. Lemon Squeezy lo usa también para todas las renovaciones de la suscripción.
  customPrice: number;
  email: string;
  userId: string;
  plan: 'basic' | 'pro';
  redirectUrl: string;
};

export interface LemonSqueezy {
  createCheckout(input: CreateCheckoutInput): Promise<{ id: string; url: string }>;
  getSubscription(id: string): Promise<LemonSubscription>;
  cancelSubscription(id: string): Promise<LemonSubscription>;
  listActiveSubscriptions(opts: { page: number; size: number }): Promise<LemonSubscriptionPage>;
}

export class LemonSqueezyError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Lemon Squeezy respondió ${status}: ${body}`);
  }
}

type RawSubscription = {
  id: string;
  attributes: {
    status: LemonSubscriptionStatus;
    customer_id: number | string;
    variant_id: number | string;
    user_email?: string | null;
    renews_at?: string | null;
    ends_at?: string | null;
  };
};

export function toSubscription(raw: RawSubscription): LemonSubscription {
  const a = raw.attributes;
  return {
    id: String(raw.id),
    status: a.status,
    customerId: String(a.customer_id),
    variantId: String(a.variant_id),
    userEmail: a.user_email ?? null,
    renewsAt: a.renews_at ?? null,
    endsAt: a.ends_at ?? null,
  };
}

export function createLemonSqueezy({ apiKey, storeId }: { apiKey: string; storeId: string }): LemonSqueezy {
  // La API es JSON:API: pide su propio media type en Accept y Content-Type.
  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${LS_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.api+json',
        ...(body ? { 'Content-Type': 'application/vnd.api+json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new LemonSqueezyError(res.status, await res.text());
    return (await res.json()) as T;
  }

  return {
    async createCheckout(input) {
      const { data } = await call<{ data: { id: string; attributes: { url: string } } }>('POST', '/checkouts', {
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: input.customPrice,
            product_options: { redirect_url: input.redirectUrl, enabled_variants: [Number(input.variantId)] },
            // custom vuelve en meta.custom_data de cada webhook: así se vincula la suscripción al usuario.
            checkout_data: { email: input.email, custom: { user_id: input.userId, plan: input.plan } },
          },
          relationships: {
            store: { data: { type: 'stores', id: storeId } },
            variant: { data: { type: 'variants', id: input.variantId } },
          },
        },
      });
      return { id: data.id, url: data.attributes.url };
    },

    async getSubscription(id) {
      const { data } = await call<{ data: RawSubscription }>('GET', `/subscriptions/${encodeURIComponent(id)}`);
      return toSubscription(data);
    },

    async cancelSubscription(id) {
      // DELETE no borra: la pasa a `cancelled` y el acceso sigue hasta ends_at, igual que MP.
      const { data } = await call<{ data: RawSubscription }>('DELETE', `/subscriptions/${encodeURIComponent(id)}`);
      return toSubscription(data);
    },

    async listActiveSubscriptions({ page, size }) {
      const qs = new URLSearchParams({
        'filter[store_id]': storeId,
        'filter[status]': 'active',
        'page[number]': String(page),
        'page[size]': String(size),
      });
      const res = await call<{ data: RawSubscription[]; meta: { page: { lastPage: number } } }>(
        'GET',
        `/subscriptions?${qs}`,
      );
      return { data: res.data.map(toSubscription), lastPage: res.meta.page.lastPage };
    },
  };
}

// Header `X-Signature`: HMAC-SHA256 (hex) del raw body con el signing secret del webhook.
export function verifyLemonSignature({
  secret,
  header,
  payload,
}: {
  secret: string;
  header: string | undefined;
  payload: string;
}): boolean {
  if (!header) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
  const received = Buffer.from(header.trim());
  return received.length === expected.length && timingSafeEqual(received, expected);
}

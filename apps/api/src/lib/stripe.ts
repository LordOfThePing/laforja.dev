const STRIPE_API = 'https://api.stripe.com/v1';

// Statuses de Stripe: https://stripe.com/docs/api/subscriptions/object#subscription_object-status
export type StripeSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export type StripePrice = { id: string };
export type StripeSubscriptionItem = { price: StripePrice };

export type StripeSubscription = {
  id: string;
  status: StripeSubscriptionStatus;
  customer: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  items: { data: StripeSubscriptionItem[] };
  metadata: Record<string, string>;
};

export type StripeCheckoutSession = {
  id: string;
  url: string;
  customer: string | null;
  subscription: string | null;
  metadata: Record<string, string> | null;
};

export type StripeCustomer = { id: string; email: string | null };

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type StripeSubscriptionList = {
  data: StripeSubscription[];
  has_more: boolean;
};

export type CreateCheckoutInput = {
  priceId: string;
  customerId?: string;
  customerEmail: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
};

export interface Stripe {
  createCustomer(email: string, userId: string): Promise<StripeCustomer>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<StripeCheckoutSession>;
  getCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  getSubscription(id: string): Promise<StripeSubscription>;
  cancelSubscription(id: string): Promise<StripeSubscription>;
  listActiveSubscriptions(opts: { startingAfter?: string; limit: number }): Promise<StripeSubscriptionList>;
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Stripe respondió ${status}: ${body}`);
  }
}

// Stripe REST usa form-encoded. Soporta estructuras anidadas con brackets:
// `metadata[user_id]=abc`, `line_items[0][price]=price_xxx`. Esto arma eso.
function encodeForm(params: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => push(`${key}[${i}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) push(`${key}[${k}]`, v);
      return;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [k, v] of Object.entries(params)) push(k, v);
  return parts.join('&');
}

export function createStripe(secretKey: string): Stripe {
  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<T> {
    const url = method === 'GET' && body ? `${STRIPE_API}${path}?${encodeForm(body)}` : `${STRIPE_API}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(method !== 'GET' && body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: method !== 'GET' && body ? encodeForm(body) : undefined,
    });
    if (!res.ok) throw new StripeError(res.status, await res.text());
    return (await res.json()) as T;
  }

  return {
    createCustomer: (email, userId) =>
      call<StripeCustomer>('POST', '/customers', { email, metadata: { user_id: userId } }),

    createCheckoutSession: (input) =>
      call<StripeCheckoutSession>('POST', '/checkout/sessions', {
        mode: 'subscription',
        // El customer se reusa entre altas para que Stripe no cree uno nuevo cada vez.
        ...(input.customerId ? { customer: input.customerId } : { customer_email: input.customerEmail }),
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // El webhook usa estos ids para vincular la subscription al usuario (si Stripe pierde el
        // link entre session y customer).
        metadata: { user_id: input.userId },
        subscription_data: { metadata: { user_id: input.userId } },
        client_reference_id: input.userId,
      }),

    getCheckoutSession: (id) =>
      call<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`),

    getSubscription: (id) => call<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`),

    cancelSubscription: (id) =>
      // cancel_at_period_end mantiene el acceso hasta el final del período pago, igual que MP.
      call<StripeSubscription>('POST', `/subscriptions/${encodeURIComponent(id)}`, {
        cancel_at_period_end: 'true',
      }),

    listActiveSubscriptions: ({ startingAfter, limit }) =>
      call<StripeSubscriptionList>('GET', '/subscriptions', {
        status: 'active',
        limit,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      }),
  };
}

// Firma de webhook: header `Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>...]`.
// Se calcula HMAC-SHA256 de `<ts>.<rawBody>` con el webhook secret y se compara con alguno de los v1.
// Toleramos un desfasaje de 5 min para que un reloj mal sincronizado no rompa el webhook.
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export async function verifyStripeSignature({
  secret,
  header,
  payload,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  secret: string;
  header: string | undefined;
  payload: string;
  nowSeconds?: number;
}): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith('t='))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!ts || sigs.length === 0) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowSeconds - tsNum) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${payload}`));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // Timing-safe compare: fuerza misma longitud y xor por byte.
  return sigs.some((sig) => sig.length === expected.length && safeEqual(sig, expected));
}

function safeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

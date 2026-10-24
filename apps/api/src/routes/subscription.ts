import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAuth } from '../auth.ts';
import { users } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';
import type { Stripe } from '../lib/stripe.ts';

// Plan Oficial (basic): 3 desbloqueos/mes. Plan Maestro (pro): acceso ilimitado.
export const OFICIAL_PRICE_ARS = 6999;
export const MAESTRO_PRICE_ARS = 19999;

// USD para Stripe (internacional). Son los montos de referencia; el precio real sale del
// price_id configurado en Stripe (STRIPE_PRICE_BASIC/PRO), que puede diferir si cambia.
export const OFICIAL_PRICE_USD = 7;
export const MAESTRO_PRICE_USD = 20;

export type Plan = 'basic' | 'pro';
export type PaymentProvider = 'mercadopago' | 'stripe';

export const PLAN_PRICES: Record<Plan, number> = {
  basic: OFICIAL_PRICE_ARS,
  pro: MAESTRO_PRICE_ARS,
};

export const PLAN_REASONS: Record<Plan, string> = {
  basic: 'La Forja — Suscripción Oficial',
  pro: 'La Forja — Suscripción Maestro',
};

// Precios → plan: así webhook y reconcile deducen el plan desde la preapproval de MP sin
// necesidad de guardar estado intermedio al crear.
export function planFromAmount(amount: number | null | undefined): Plan | null {
  if (amount === OFICIAL_PRICE_ARS) return 'basic';
  if (amount === MAESTRO_PRICE_ARS) return 'pro';
  return null;
}

function parsePlan(raw: unknown): Plan | null {
  return raw === 'basic' || raw === 'pro' ? raw : null;
}

function parseProvider(raw: unknown): PaymentProvider | null {
  if (raw === undefined || raw === null) return 'mercadopago';
  return raw === 'mercadopago' || raw === 'stripe' ? raw : null;
}

export type StripeConfig = {
  client: Stripe;
  // priceId por plan: viene de env (STRIPE_PRICE_BASIC/PRO).
  prices: Record<Plan, string>;
  successUrl: string;
  cancelUrl: string;
};

type Options = {
  auth: AuthConfig;
  // URL absoluta donde MP redirige al usuario al terminar el alta (viene resuelta desde app.ts).
  backUrl: string;
  mp: MercadoPago;
  // Sin stripe = Stripe apagado: pedir `provider:'stripe'` responde 503 provider_disabled.
  stripe?: StripeConfig;
};

export function subscriptionRoutes({ auth, backUrl, mp, stripe }: Options) {
  const { db } = auth;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(auth));

  app.post('/create', async (c) => {
    const user = c.get('user');
    if (user.subscriptionStatus === 'active' && hasSubscriptionAccess(user)) {
      return c.json({ error: 'already_subscribed' }, 409);
    }

    const body = (await c.req.json().catch(() => null)) as { plan?: unknown; provider?: unknown } | null;
    const plan = parsePlan(body?.plan);
    if (!plan) return c.json({ error: 'invalid_plan' }, 400);
    const provider = parseProvider(body?.provider);
    if (!provider) return c.json({ error: 'invalid_provider' }, 400);

    if (provider === 'stripe') {
      if (!stripe) return c.json({ error: 'provider_disabled' }, 503);

      // Reusar customer entre altas: evita que Stripe cree uno nuevo por cada intento y mantiene
      // el historial de pagos unificado.
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.client.createCustomer(user.email, user.id);
        customerId = customer.id;
        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
      }

      const session = await stripe.client.createCheckoutSession({
        priceId: stripe.prices[plan],
        customerId,
        customerEmail: user.email,
        userId: user.id,
        successUrl: stripe.successUrl,
        cancelUrl: stripe.cancelUrl,
      });

      return c.json({ initPoint: session.url, sessionId: session.id, plan, provider });
    }

    const preapproval = await mp.createPreapproval({
      reason: PLAN_REASONS[plan],
      amount: PLAN_PRICES[plan],
      payerEmail: user.email,
      externalReference: user.id,
      backUrl,
    });

    return c.json({
      initPoint: preapproval.init_point,
      preapprovalId: preapproval.id,
      plan,
      provider: 'mercadopago',
    });
  });

  app.post('/cancel', async (c) => {
    const user = c.get('user');
    const active = user.subscriptionStatus === 'active' || user.subscriptionStatus === 'paused';
    if (!active) return c.json({ error: 'no_active_subscription' }, 409);

    if (user.paymentProvider === 'stripe') {
      if (!stripe) return c.json({ error: 'provider_disabled' }, 503);
      if (!user.stripeSubscriptionId) return c.json({ error: 'no_active_subscription' }, 409);
      await stripe.client.cancelSubscription(user.stripeSubscriptionId);
    } else {
      if (!user.subscriptionId) return c.json({ error: 'no_active_subscription' }, 409);
      await mp.cancelPreapproval(user.subscriptionId);
    }

    // El webhook del provider confirma lo mismo después; marcarlo ya evita que el dashboard muestre
    // "activa" hasta que llegue. current_period_end se conserva: el período pago se respeta.
    const [updated] = await db
      .update(users)
      .set({ subscriptionStatus: 'cancelled' })
      .where(eq(users.id, user.id))
      .returning({
        status: users.subscriptionStatus,
        plan: users.subscriptionPlan,
        currentPeriodEnd: users.currentPeriodEnd,
      });

    return c.json({ subscription: updated });
  });

  return app;
}

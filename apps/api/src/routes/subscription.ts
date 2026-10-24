import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAuth } from '../auth.ts';
import { users } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';
import { PROVIDER_CURRENCY, loadPrices } from '../lib/prices.ts';
import type { Stripe } from '../lib/stripe.ts';

// Plan Oficial (basic): 3 desbloqueos/mes. Plan Maestro (pro): acceso ilimitado.
// Los montos viven en la tabla plan_prices (editable desde el panel admin, ver lib/prices.ts).
export type Plan = 'basic' | 'pro';
export type PaymentProvider = 'mercadopago' | 'stripe';

export const PLAN_REASONS: Record<Plan, string> = {
  basic: 'La Forja — Suscripción Oficial',
  pro: 'La Forja — Suscripción Maestro',
};

// Montos ARS que estaban hardcodeados antes de plan_prices: las preapprovals de esa época se
// siguen reconociendo por monto si el reason no matchea.
const LEGACY_ARS_AMOUNTS: Record<number, Plan> = { 6999: 'basic', 19999: 'pro' };

// El plan sale del reason (fijo por plan) y no del monto: así cambiar el precio desde el panel no
// rompe el reconocimiento de las preapprovals viejas ni de las nuevas.
export function planFromPreapproval(pre: {
  reason?: string | null;
  auto_recurring?: { transaction_amount?: number | null } | null;
}): Plan | null {
  for (const plan of ['basic', 'pro'] as const) if (pre.reason === PLAN_REASONS[plan]) return plan;
  const amount = pre.auto_recurring?.transaction_amount;
  return amount != null ? (LEGACY_ARS_AMOUNTS[amount] ?? null) : null;
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

      const prices = await loadPrices(db);
      const session = await stripe.client.createCheckoutSession({
        plan,
        productName: PLAN_REASONS[plan],
        amount: prices[plan][PROVIDER_CURRENCY.stripe],
        currency: PROVIDER_CURRENCY.stripe,
        customerId,
        customerEmail: user.email,
        userId: user.id,
        successUrl: stripe.successUrl,
        cancelUrl: stripe.cancelUrl,
      });

      return c.json({ initPoint: session.url, sessionId: session.id, plan, provider });
    }

    const prices = await loadPrices(db);
    const preapproval = await mp.createPreapproval({
      reason: PLAN_REASONS[plan],
      // MP recibe el monto en unidades, no en centavos.
      amount: prices[plan][PROVIDER_CURRENCY.mercadopago] / 100,
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

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAuth } from '../auth.ts';
import { users } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';

// Plan Oficial (basic): 3 desbloqueos/mes. Plan Maestro (pro): acceso ilimitado.
export const OFICIAL_PRICE_ARS = 6999;
export const MAESTRO_PRICE_ARS = 19999;

export type Plan = 'basic' | 'pro';

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

type Options = {
  auth: AuthConfig;
  // URL absoluta donde MP redirige al usuario al terminar el alta (viene resuelta desde app.ts).
  backUrl: string;
  mp: MercadoPago;
};

export function subscriptionRoutes({ auth, backUrl, mp }: Options) {
  const { db } = auth;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(auth));

  app.post('/create', async (c) => {
    const user = c.get('user');
    if (user.subscriptionStatus === 'active' && hasSubscriptionAccess(user)) {
      return c.json({ error: 'already_subscribed' }, 409);
    }

    const body = (await c.req.json().catch(() => null)) as { plan?: unknown } | null;
    const plan = parsePlan(body?.plan);
    if (!plan) return c.json({ error: 'invalid_plan' }, 400);

    const preapproval = await mp.createPreapproval({
      reason: PLAN_REASONS[plan],
      amount: PLAN_PRICES[plan],
      payerEmail: user.email,
      externalReference: user.id,
      backUrl,
    });

    return c.json({ initPoint: preapproval.init_point, preapprovalId: preapproval.id, plan });
  });

  app.post('/cancel', async (c) => {
    const user = c.get('user');
    if (!user.subscriptionId || (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'paused')) {
      return c.json({ error: 'no_active_subscription' }, 409);
    }

    await mp.cancelPreapproval(user.subscriptionId);
    // El webhook de MP confirma lo mismo después; marcarlo ya evita que el dashboard muestre
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

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAuth } from '../auth.ts';
import { users } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';

export const SUBSCRIPTION_PRICE_ARS = 4000;
export const SUBSCRIPTION_REASON = 'La Forja — Suscripción mensual';

type Options = {
  auth: AuthConfig;
  frontendUrl: string;
  mp: MercadoPago;
};

export function subscriptionRoutes({ auth, frontendUrl, mp }: Options) {
  const { db } = auth;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(auth));

  app.post('/create', async (c) => {
    const user = c.get('user');
    if (user.subscriptionStatus === 'active' && hasSubscriptionAccess(user)) {
      return c.json({ error: 'already_subscribed' }, 409);
    }

    const preapproval = await mp.createPreapproval({
      reason: SUBSCRIPTION_REASON,
      amount: SUBSCRIPTION_PRICE_ARS,
      payerEmail: user.email,
      externalReference: user.id,
      backUrl: `${frontendUrl}/dashboard/gracias`,
    });

    return c.json({ initPoint: preapproval.init_point, preapprovalId: preapproval.id });
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
      .returning({ status: users.subscriptionStatus, currentPeriodEnd: users.currentPeriodEnd });

    return c.json({ subscription: updated });
  });

  return app;
}

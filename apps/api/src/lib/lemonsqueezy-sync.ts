import { and, eq } from 'drizzle-orm';
import { users } from '../db/schema.ts';
import type { Plan } from '../routes/subscription.ts';
import type { LemonSubscription } from './lemonsqueezy.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UserUpdate = {
  where: ReturnType<typeof and>;
  set: Partial<typeof users.$inferInsert>;
};

export type VariantPlans = Record<string, Plan>;

export function variantPlans(variants: Record<Plan, string>): VariantPlans {
  return { [variants.basic]: 'basic', [variants.pro]: 'pro' };
}

export function parseCustomData(raw: unknown): { userId: string | null; plan: Plan | null } {
  const data = (raw ?? {}) as { user_id?: unknown; plan?: unknown };
  const userId = typeof data.user_id === 'string' && UUID_RE.test(data.user_id) ? data.user_id : null;
  const plan = data.plan === 'basic' || data.plan === 'pro' ? data.plan : null;
  return { userId, plan };
}

// cancelled = el usuario canceló pero el período pago sigue (ends_at en el futuro); expired = terminó.
// past_due / unpaid: LS está reintentando el cobro o se rindió; sin acceso pero sin perder el vínculo.
export function mapStatus(status: LemonSubscription['status']): 'active' | 'paused' | 'cancelled' {
  if (status === 'active' || status === 'on_trial') return 'active';
  if (status === 'cancelled' || status === 'expired') return 'cancelled';
  return 'paused';
}

/**
 * Traduce una suscripción de LS a un update sobre `users`.
 *
 * El plan sale de la variant (configurada por env) y, si no matchea, del custom_data del checkout;
 * si ninguno sirve se conserva el actual. Sin userId no se puede activar, pero sí bajar una
 * suscripción ya vinculada (por ls_subscription_id).
 */
export function updateFromSubscription(
  sub: LemonSubscription,
  { userId, plan: customPlan, variantPlans }: { userId: string | null; plan: Plan | null; variantPlans: VariantPlans },
): UserUpdate | null {
  const status = mapStatus(sub.status);

  if (status === 'active') {
    if (!userId) return null;
    const plan = variantPlans[sub.variantId] ?? customPlan;
    const set: Partial<typeof users.$inferInsert> = {
      subscriptionStatus: 'active',
      paymentProvider: 'lemonsqueezy',
      lsSubscriptionId: sub.id,
      lsCustomerId: sub.customerId,
      currentPeriodEnd: sub.renewsAt ? new Date(sub.renewsAt) : null,
    };
    if (plan) set.subscriptionPlan = plan;
    return { where: eq(users.id, userId), set };
  }

  // Solo la suscripción vigente del usuario: bajar una vieja no tiene que pisar una activa más nueva.
  const current = userId
    ? and(eq(users.id, userId), eq(users.lsSubscriptionId, sub.id))
    : eq(users.lsSubscriptionId, sub.id);
  const set: Partial<typeof users.$inferInsert> = { subscriptionStatus: status };
  if (status === 'cancelled' && sub.endsAt) set.currentPeriodEnd = new Date(sub.endsAt);
  return { where: current, set };
}

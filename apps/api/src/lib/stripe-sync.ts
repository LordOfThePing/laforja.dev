import { and, eq } from 'drizzle-orm';
import { users } from '../db/schema.ts';
import type { Plan } from '../routes/subscription.ts';
import type { StripeSubscription, StripeSubscriptionStatus } from './stripe.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UserUpdate = {
  where: ReturnType<typeof and>;
  set: Partial<typeof users.$inferInsert>;
};

// current_period_end viene en segundos unix. Stripe cobra el día del renew y despacha el webhook
// de inmediato, así que no hace falta margen de gracia como con MP.
export function periodEnd(sub: StripeSubscription): Date {
  return new Date(sub.current_period_end * 1000);
}

export function userIdFromSubscription(sub: StripeSubscription): string | null {
  const ref = sub.metadata?.user_id;
  return ref && UUID_RE.test(ref) ? ref : null;
}

// cancel_at_period_end=true quiere decir que el usuario ya cliqueó cancelar pero el período
// pago sigue vigente. Reflejarlo como 'cancelled' acá hace que el dashboard muestre la fecha
// de corte, igual que MP.
export function mapStatus(sub: StripeSubscription): 'active' | 'paused' | 'cancelled' | null {
  if (sub.cancel_at_period_end) return 'cancelled';
  const s: StripeSubscriptionStatus = sub.status;
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'canceled') return 'cancelled';
  // past_due, unpaid, incomplete, incomplete_expired, paused: el usuario no tiene acceso válido
  // pero mantenemos la fila para que un pago posterior reactive sin re-vincular.
  return 'paused';
}

export function planFromPriceId(
  sub: StripeSubscription,
  priceToPlan: Record<string, Plan>,
): Plan | null {
  const priceId = sub.items.data[0]?.price?.id;
  if (!priceId) return null;
  return priceToPlan[priceId] ?? null;
}

/**
 * Traduce una suscripción de Stripe a un update sobre `users`. Devuelve null si no se puede
 * identificar al usuario (metadata.user_id ausente o inválido). El caller resuelve por qué.
 *
 * El plan se setea solo si el price_id está mapeado: si Stripe devuelve un price desconocido
 * conservamos el plan actual (igual que con MP y amounts no reconocidos).
 */
export function updateFromSubscription(
  sub: StripeSubscription,
  priceToPlan: Record<string, Plan>,
): UserUpdate | null {
  const userId = userIdFromSubscription(sub);
  if (!userId) return null;

  const status = mapStatus(sub);
  if (!status) return null;

  if (status === 'active') {
    const plan = planFromPriceId(sub, priceToPlan);
    const set: Partial<typeof users.$inferInsert> = {
      subscriptionStatus: 'active',
      paymentProvider: 'stripe',
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer,
      currentPeriodEnd: periodEnd(sub),
    };
    if (plan) set.subscriptionPlan = plan;
    return { where: eq(users.id, userId), set };
  }

  // Solo tocamos si es la subscription vigente del usuario (igual que con MP): cancelar/pausar
  // una vieja no tiene que pisar una activa más nueva.
  const current = and(eq(users.id, userId), eq(users.stripeSubscriptionId, sub.id));
  return { where: current, set: { subscriptionStatus: status, currentPeriodEnd: periodEnd(sub) } };
}

import { and, eq } from 'drizzle-orm';
import { users } from '../db/schema.ts';
import { planFromPreapproval } from '../routes/subscription.ts';
import type { Preapproval } from './mercadopago.ts';

// MP cobra en next_payment_date y el webhook del cobro llega después; sin este margen el
// suscriptor perdería el acceso unas horas en cada renovación.
const PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UserUpdate = {
  where: ReturnType<typeof and>;
  set: Partial<typeof users.$inferInsert>;
};

export function periodEnd(pre: Preapproval): Date | null {
  if (!pre.next_payment_date) return null;
  return new Date(new Date(pre.next_payment_date).getTime() + PERIOD_GRACE_MS);
}

export function userIdFromReference(pre: Preapproval): string | null {
  const ref = pre.external_reference;
  return ref && UUID_RE.test(ref) ? ref : null;
}

export function updateFromPreapproval(pre: Preapproval): UserUpdate | null {
  const userId = userIdFromReference(pre);
  if (!userId) return null;

  if (pre.status === 'authorized') {
    // Si no se reconoce el plan conservamos el actual del usuario (set no incluye subscriptionPlan).
    const plan = planFromPreapproval(pre);
    const set: Partial<typeof users.$inferInsert> = {
      subscriptionStatus: 'active',
      // Un usuario que venía de Stripe y se pasa a MP tiene que cancelar por MP de acá en más.
      paymentProvider: 'mercadopago',
      subscriptionId: pre.id,
      currentPeriodEnd: periodEnd(pre),
    };
    if (plan) set.subscriptionPlan = plan;
    return { where: eq(users.id, userId), set };
  }
  // Solo si es la suscripción vigente del usuario: cancelar una preapproval vieja que quedó
  // pendiente no tiene que tocar una suscripción activa más nueva.
  const current = and(eq(users.id, userId), eq(users.subscriptionId, pre.id));
  if (pre.status === 'paused') return { where: current, set: { subscriptionStatus: 'paused' } };
  if (pre.status === 'cancelled') return { where: current, set: { subscriptionStatus: 'cancelled' } };
  return null;
}

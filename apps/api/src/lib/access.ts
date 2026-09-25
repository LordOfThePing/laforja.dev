import type { users } from '../db/schema.ts';

type SubscriptionFields = Pick<
  typeof users.$inferSelect,
  'subscriptionStatus' | 'currentPeriodEnd'
>;

// Una suscripción cancelada conserva el acceso hasta el fin del período ya pagado.
export function hasSubscriptionAccess(user: SubscriptionFields, now: Date = new Date()): boolean {
  const { subscriptionStatus: status, currentPeriodEnd: end } = user;
  if (status === 'active') return end === null || end > now;
  if (status === 'cancelled') return end !== null && end > now;
  return false;
}

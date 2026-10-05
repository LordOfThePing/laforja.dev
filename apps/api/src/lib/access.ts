import type { users } from '../db/schema.ts';

type SubscriptionFields = Pick<
  typeof users.$inferSelect,
  'subscriptionStatus' | 'subscriptionPlan' | 'currentPeriodEnd'
>;

type RoleField = Pick<typeof users.$inferSelect, 'role'>;

// Una suscripción cancelada conserva el acceso hasta el fin del período ya pagado.
export function hasSubscriptionAccess(user: SubscriptionFields, now: Date = new Date()): boolean {
  const { subscriptionStatus: status, currentPeriodEnd: end } = user;
  if (status === 'active') return end === null || end > now;
  if (status === 'cancelled') return end !== null && end > now;
  return false;
}

// 'maestro' incluye admin y suscriptor pro: acceso total sin gastar cupo.
// 'oficial' = suscriptor basic: cupo de 3 por mes.
// 'aprendiz' = resto (sin suscripción vigente): cupo de 1 por mes.
export type Access = 'maestro' | 'oficial' | 'aprendiz';

export function accessLevel(user: SubscriptionFields & RoleField, now: Date = new Date()): Access {
  if (user.role === 'admin') return 'maestro';
  if (!hasSubscriptionAccess(user, now)) return 'aprendiz';
  return user.subscriptionPlan === 'basic' ? 'oficial' : 'maestro';
}

export function hasFullAccess(
  user: SubscriptionFields & RoleField,
  now: Date = new Date(),
): boolean {
  return accessLevel(user, now) === 'maestro';
}

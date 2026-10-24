import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { subscriptionEvents, users } from './db/schema.ts';
import { type MercadoPago, MercadoPagoError, type Preapproval } from './lib/mercadopago.ts';
import { updateFromPreapproval, userIdFromReference } from './lib/preapproval.ts';
import { type Stripe, StripeError, type StripeSubscription } from './lib/stripe.ts';
import { updateFromSubscription, userIdFromSubscription } from './lib/stripe-sync.ts';

const PAGE_SIZE = 50;

type UserState = Pick<typeof users.$inferSelect, 'subscriptionStatus' | 'subscriptionId' | 'currentPeriodEnd'>;

export type ReconcileChange = {
  userId: string;
  preapprovalId: string;
  before: UserState;
  after: UserState;
};

export type ReconcileResult = { checked: number; changes: ReconcileChange[] };

async function allAuthorized(mp: MercadoPago): Promise<Preapproval[]> {
  const found: Preapproval[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await mp.searchPreapprovals({ status: 'authorized', offset, limit: PAGE_SIZE });
    // El filtro por status también se aplica acá: si MP lo ignorara, una preapproval cancelada
    // se tomaría como la vigente.
    found.push(...page.results.filter((p) => p.status === 'authorized'));
    if (page.results.length === 0 || offset + PAGE_SIZE >= page.paging.total) return found;
  }
}

function sameState(a: UserState, b: UserState): boolean {
  return (
    a.subscriptionStatus === b.subscriptionStatus &&
    a.subscriptionId === b.subscriptionId &&
    (a.currentPeriodEnd?.getTime() ?? null) === (b.currentPeriodEnd?.getTime() ?? null)
  );
}

/**
 * Red de seguridad por si se pierde un webhook de MP: aplica el estado real de cada
 * preapproval con las mismas reglas que el webhook de `subscription_preapproval`.
 *
 * - Preapprovals `authorized`: cubre el primer webhook perdido (al crear no se guarda nada,
 *   el usuario queda vinculado solo por `external_reference`) y renovaciones sin avisar.
 * - Usuarios `active`/`paused` cuya preapproval no está entre las autorizadas: se consulta
 *   una por una, para bajar las que MP pausó o canceló.
 *
 * Un error de MP (salvo un 404 puntual) corta la corrida antes de escribir nada.
 */
export async function reconcileSubscriptions(
  db: Db,
  mp: MercadoPago,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const latestByUser = new Map<string, Preapproval>();
  for (const pre of await allAuthorized(mp)) {
    const userId = userIdFromReference(pre);
    if (!userId) continue;
    const prev = latestByUser.get(userId);
    if (!prev || (pre.next_payment_date ?? '') > (prev.next_payment_date ?? '')) latestByUser.set(userId, pre);
  }

  const tracked = await db
    .select({ id: users.id, subscriptionId: users.subscriptionId })
    .from(users)
    .where(and(isNotNull(users.subscriptionId), inArray(users.subscriptionStatus, ['active', 'paused'])));
  for (const user of tracked) {
    if (latestByUser.has(user.id) || !user.subscriptionId) continue;
    try {
      latestByUser.set(user.id, await mp.getPreapproval(user.subscriptionId));
    } catch (err) {
      // Una preapproval que MP no conoce (p. ej. creada con otras credenciales) no tiene que
      // frenar la reconciliación del resto para siempre.
      if (!(err instanceof MercadoPagoError && err.status === 404)) throw err;
      console.warn(`reconcile: MP no encuentra la preapproval ${user.subscriptionId} del usuario ${user.id}`);
    }
  }

  const runId = new Date().toISOString();
  const changes: ReconcileChange[] = [];
  for (const [userId, pre] of latestByUser) {
    const update = updateFromPreapproval(pre);
    if (!update) continue;

    const change = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          subscriptionStatus: users.subscriptionStatus,
          subscriptionId: users.subscriptionId,
          currentPeriodEnd: users.currentPeriodEnd,
        })
        .from(users)
        .where(update.where);
      if (!before) return null;
      const after: UserState = { ...before, ...update.set } as UserState;
      if (sameState(before, after)) return null;
      if (!dryRun) {
        await tx.update(users).set(update.set).where(update.where);
        await tx.insert(subscriptionEvents).values({
          providerEventId: `reconcile:mp:${pre.id}:${runId}`,
          eventType: 'reconciliation',
          userId,
          payload: { preapproval: { id: pre.id, status: pre.status, next_payment_date: pre.next_payment_date }, before, after },
        });
      }
      return { userId, preapprovalId: pre.id, before, after };
    });
    if (change) changes.push(change);
  }

  return { checked: latestByUser.size, changes };
}

async function allActiveStripe(stripe: Stripe): Promise<StripeSubscription[]> {
  const found: StripeSubscription[] = [];
  let startingAfter: string | undefined;
  // Stripe limita a 100 por página; `has_more` indica si hay que seguir.
  for (;;) {
    const page = await stripe.listActiveSubscriptions({ startingAfter, limit: 100 });
    found.push(...page.data);
    if (!page.has_more || page.data.length === 0) return found;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) return found;
  }
}

export type StripeReconcileChange = {
  userId: string;
  subscriptionId: string;
  before: UserState;
  after: UserState;
};

/**
 * Red de seguridad para Stripe. Mismo patrón que MP:
 * - Lista subscriptions `active` de Stripe y aplica el estado real.
 * - Usuarios locales con `payment_provider = 'stripe'` y status active/paused cuya subscription
 *   no apareció → se consulta una por una (así se ven las que Stripe pasó a canceled/past_due).
 */
export async function reconcileStripeSubscriptions(
  db: Db,
  stripe: Stripe,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ checked: number; changes: StripeReconcileChange[] }> {
  const bySubId = new Map<string, StripeSubscription>();

  for (const sub of await allActiveStripe(stripe)) {
    if (!userIdFromSubscription(sub)) continue;
    bySubId.set(sub.id, sub);
  }

  const tracked = await db
    .select({ id: users.id, stripeSubscriptionId: users.stripeSubscriptionId })
    .from(users)
    .where(
      and(
        eq(users.paymentProvider, 'stripe'),
        isNotNull(users.stripeSubscriptionId),
        inArray(users.subscriptionStatus, ['active', 'paused']),
      ),
    );
  for (const user of tracked) {
    if (!user.stripeSubscriptionId || bySubId.has(user.stripeSubscriptionId)) continue;
    try {
      const sub = await stripe.getSubscription(user.stripeSubscriptionId);
      bySubId.set(sub.id, sub);
    } catch (err) {
      if (!(err instanceof StripeError && err.status === 404)) throw err;
      console.warn(`reconcile stripe: no se encuentra ${user.stripeSubscriptionId} del usuario ${user.id}`);
    }
  }

  const runId = new Date().toISOString();
  const changes: StripeReconcileChange[] = [];
  for (const sub of bySubId.values()) {
    const update = updateFromSubscription(sub);
    if (!update) continue;
    const userId = userIdFromSubscription(sub);
    if (!userId) continue;

    const change = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          subscriptionStatus: users.subscriptionStatus,
          subscriptionId: users.subscriptionId,
          currentPeriodEnd: users.currentPeriodEnd,
        })
        .from(users)
        .where(update.where);
      if (!before) return null;
      const after: UserState = { ...before, ...update.set } as UserState;
      if (sameState(before, after)) return null;
      if (!dryRun) {
        await tx.update(users).set(update.set).where(update.where);
        await tx.insert(subscriptionEvents).values({
          providerEventId: `reconcile:stripe:${sub.id}:${runId}`,
          eventType: 'reconciliation',
          userId,
          payload: { subscription: { id: sub.id, status: sub.status, current_period_end: sub.current_period_end } },
        });
      }
      return { userId, subscriptionId: sub.id, before, after };
    });
    if (change) changes.push(change);
  }

  return { checked: bySubId.size, changes };
}

type ReconcilerDeps = {
  mp: MercadoPago;
  stripe?: Stripe;
};

export function startReconciler(db: Db, deps: ReconcilerDeps, intervalMs: number, firstRunDelayMs = 60_000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const mpResult = await reconcileSubscriptions(db, deps.mp);
      console.log(`reconcile mp: ${mpResult.checked} revisadas, ${mpResult.changes.length} corregidas`);
      for (const c of mpResult.changes) {
        console.log(`reconcile mp: usuario ${c.userId} (${c.preapprovalId}): ${c.before.subscriptionStatus} → ${c.after.subscriptionStatus}`);
      }
      if (deps.stripe) {
        const stripeResult = await reconcileStripeSubscriptions(db, deps.stripe);
        console.log(`reconcile stripe: ${stripeResult.checked} revisadas, ${stripeResult.changes.length} corregidas`);
        for (const c of stripeResult.changes) {
          console.log(`reconcile stripe: usuario ${c.userId} (${c.subscriptionId}): ${c.before.subscriptionStatus} → ${c.after.subscriptionStatus}`);
        }
      }
    } catch (err) {
      console.error('reconcile: falló, se reintenta en la próxima corrida', err);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, firstRunDelayMs);
  const every = setInterval(run, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { subscriptionEvents, users } from './db/schema.ts';
import { type MercadoPago, MercadoPagoError, type Preapproval } from './lib/mercadopago.ts';
import { updateFromPreapproval, userIdFromReference } from './lib/preapproval.ts';
import { type LemonSqueezy, LemonSqueezyError, type LemonSubscription } from './lib/lemonsqueezy.ts';
import { type VariantPlans, updateFromSubscription } from './lib/lemonsqueezy-sync.ts';

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

async function allActiveLemon(lemon: LemonSqueezy): Promise<LemonSubscription[]> {
  const found: LemonSubscription[] = [];
  for (let page = 1; ; page += 1) {
    const res = await lemon.listActiveSubscriptions({ page, size: 100 });
    found.push(...res.data);
    if (page >= res.lastPage || res.data.length === 0) return found;
  }
}

type LemonState = Pick<
  typeof users.$inferSelect,
  'subscriptionStatus' | 'subscriptionPlan' | 'lsSubscriptionId' | 'currentPeriodEnd'
>;

export type LemonReconcileChange = {
  userId: string;
  subscriptionId: string;
  before: LemonState;
  after: LemonState;
};

function sameLemonState(a: LemonState, b: LemonState): boolean {
  return (
    a.subscriptionStatus === b.subscriptionStatus &&
    a.subscriptionPlan === b.subscriptionPlan &&
    a.lsSubscriptionId === b.lsSubscriptionId &&
    (a.currentPeriodEnd?.getTime() ?? null) === (b.currentPeriodEnd?.getTime() ?? null)
  );
}

/**
 * Red de seguridad para Lemon Squeezy, mismo patrón que MP:
 * - Lista las suscripciones `active` del store. Fuera del webhook no hay custom_data, así que el
 *   usuario se busca por ls_subscription_id y, si todavía no estaba vinculada (se perdió el primer
 *   webhook), por el email con el que pagó.
 * - Usuarios con `payment_provider = 'lemonsqueezy'` active/paused cuya suscripción no apareció →
 *   se consulta una por una (así se ven las que LS canceló, venció o dejó en past_due).
 */
export async function reconcileLemonSubscriptions(
  db: Db,
  lemon: LemonSqueezy,
  variantPlans: VariantPlans,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ checked: number; changes: LemonReconcileChange[] }> {
  const userBySub = new Map<string, string>();
  const subs = new Map<string, LemonSubscription>();

  for (const sub of await allActiveLemon(lemon)) {
    const [linked] = await db.select({ id: users.id }).from(users).where(eq(users.lsSubscriptionId, sub.id));
    const [byEmail] =
      linked || !sub.userEmail
        ? []
        : await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, sub.userEmail.toLowerCase()));
    const owner = linked ?? byEmail;
    if (!owner) continue;
    userBySub.set(sub.id, owner.id);
    subs.set(sub.id, sub);
  }

  const tracked = await db
    .select({ id: users.id, lsSubscriptionId: users.lsSubscriptionId })
    .from(users)
    .where(
      and(
        eq(users.paymentProvider, 'lemonsqueezy'),
        isNotNull(users.lsSubscriptionId),
        inArray(users.subscriptionStatus, ['active', 'paused']),
      ),
    );
  for (const user of tracked) {
    if (!user.lsSubscriptionId || subs.has(user.lsSubscriptionId)) continue;
    try {
      subs.set(user.lsSubscriptionId, await lemon.getSubscription(user.lsSubscriptionId));
      userBySub.set(user.lsSubscriptionId, user.id);
    } catch (err) {
      if (!(err instanceof LemonSqueezyError && err.status === 404)) throw err;
      console.warn(`reconcile lemonsqueezy: no se encuentra ${user.lsSubscriptionId} del usuario ${user.id}`);
    }
  }

  const runId = new Date().toISOString();
  const changes: LemonReconcileChange[] = [];
  for (const sub of subs.values()) {
    const userId = userBySub.get(sub.id);
    if (!userId) continue;
    const update = updateFromSubscription(sub, { userId, plan: null, variantPlans });
    if (!update) continue;

    const change = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({
          subscriptionStatus: users.subscriptionStatus,
          subscriptionPlan: users.subscriptionPlan,
          lsSubscriptionId: users.lsSubscriptionId,
          currentPeriodEnd: users.currentPeriodEnd,
        })
        .from(users)
        .where(update.where);
      if (!before) return null;
      const after = { ...before, ...update.set } as LemonState;
      if (sameLemonState(before, after)) return null;
      if (!dryRun) {
        await tx.update(users).set(update.set).where(update.where);
        await tx.insert(subscriptionEvents).values({
          providerEventId: `reconcile:ls:${sub.id}:${runId}`,
          eventType: 'reconciliation',
          userId,
          payload: { subscription: { id: sub.id, status: sub.status, renews_at: sub.renewsAt, ends_at: sub.endsAt }, before, after },
        });
      }
      return { userId, subscriptionId: sub.id, before, after };
    });
    if (change) changes.push(change);
  }

  return { checked: subs.size, changes };
}

type ReconcilerDeps = {
  mp: MercadoPago;
  lemon?: { client: LemonSqueezy; variantPlans: VariantPlans };
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
      if (deps.lemon) {
        const lsResult = await reconcileLemonSubscriptions(db, deps.lemon.client, deps.lemon.variantPlans);
        console.log(`reconcile lemonsqueezy: ${lsResult.checked} revisadas, ${lsResult.changes.length} corregidas`);
        for (const c of lsResult.changes) {
          console.log(`reconcile lemonsqueezy: usuario ${c.userId} (${c.subscriptionId}): ${c.before.subscriptionStatus} → ${c.after.subscriptionStatus}`);
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

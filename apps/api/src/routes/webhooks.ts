import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { subscriptionEvents, users } from '../db/schema.ts';
import type { MercadoPago, Preapproval } from '../lib/mercadopago.ts';
import { verifyMpSignature } from '../lib/mp-signature.ts';

// MP cobra en next_payment_date y el webhook del cobro llega después; sin este margen el
// suscriptor perdería el acceso unas horas en cada renovación.
const PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UserUpdate = {
  where: ReturnType<typeof and>;
  set: Partial<typeof users.$inferInsert>;
};

type Options = {
  db: Db;
  mp: MercadoPago;
  webhookSecret: string;
};

function periodEnd(pre: Preapproval): Date | null {
  if (!pre.next_payment_date) return null;
  return new Date(new Date(pre.next_payment_date).getTime() + PERIOD_GRACE_MS);
}

function userIdFromReference(pre: Preapproval): string | null {
  const ref = pre.external_reference;
  return ref && UUID_RE.test(ref) ? ref : null;
}

function updateFromPreapproval(pre: Preapproval): UserUpdate | null {
  const userId = userIdFromReference(pre);
  if (!userId) return null;

  if (pre.status === 'authorized') {
    return {
      where: eq(users.id, userId),
      set: { subscriptionStatus: 'active', subscriptionId: pre.id, currentPeriodEnd: periodEnd(pre) },
    };
  }
  // Solo si es la suscripción vigente del usuario: cancelar una preapproval vieja que quedó
  // pendiente no tiene que tocar una suscripción activa más nueva.
  const current = and(eq(users.id, userId), eq(users.subscriptionId, pre.id));
  if (pre.status === 'paused') return { where: current, set: { subscriptionStatus: 'paused' } };
  if (pre.status === 'cancelled') return { where: current, set: { subscriptionStatus: 'cancelled' } };
  return null;
}

async function resolveUpdate(
  mp: MercadoPago,
  type: string | undefined,
  dataId: string,
): Promise<{ update: UserUpdate | null; userId: string | null }> {
  if (type === 'subscription_preapproval') {
    const pre = await mp.getPreapproval(dataId);
    return { update: updateFromPreapproval(pre), userId: userIdFromReference(pre) };
  }

  if (type === 'subscription_authorized_payment') {
    const payment = await mp.getAuthorizedPayment(dataId);
    const pre = await mp.getPreapproval(payment.preapproval_id);
    const userId = userIdFromReference(pre);
    const where = eq(users.subscriptionId, pre.id);
    const status = payment.payment?.status;
    if (status === 'approved') {
      return {
        userId,
        update: { where, set: { subscriptionStatus: 'active', currentPeriodEnd: periodEnd(pre) } },
      };
    }
    if (status === 'rejected') {
      return { userId, update: { where, set: { subscriptionStatus: 'paused' } } };
    }
    return { userId, update: null };
  }

  return { update: null, userId: null };
}

export function webhookRoutes({ db, mp, webhookSecret }: Options) {
  const app = new Hono();

  app.post('/mercadopago', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string | number;
      type?: string;
      data?: { id?: string | number };
    };
    const dataId = c.req.query('data.id') ?? c.req.query('id');
    const type = c.req.query('type') ?? body.type;
    const requestId = c.req.header('x-request-id');

    const valid = verifyMpSignature({
      secret: webhookSecret,
      xSignature: c.req.header('x-signature'),
      xRequestId: requestId,
      dataId,
    });
    if (!valid) return c.json({ error: 'invalid_signature' }, 401);
    if (!dataId) return c.json({ error: 'missing_data_id' }, 400);

    const mpEventId = body.id !== undefined ? String(body.id) : `${type}:${dataId}:${requestId}`;

    const [seen] = await db
      .select({ id: subscriptionEvents.id })
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.mpEventId, mpEventId))
      .limit(1);
    if (seen) return c.json({ status: 'duplicate' });

    // Se consulta a MP antes de abrir la transacción: si MP falla respondemos 500 sin
    // registrar el evento, y el reintento de MP lo vuelve a procesar.
    const { update, userId } = await resolveUpdate(mp, type, dataId);

    const status = await db.transaction(async (tx) => {
      const [owner] = userId
        ? await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))
        : [];
      const inserted = await tx
        .insert(subscriptionEvents)
        .values({ mpEventId, eventType: type ?? 'unknown', userId: owner?.id ?? null, payload: body })
        .onConflictDoNothing()
        .returning({ id: subscriptionEvents.id });
      if (inserted.length === 0) return 'duplicate';
      if (update) await tx.update(users).set(update.set).where(update.where);
      return 'processed';
    });

    return c.json({ status });
  });

  return app;
}

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { subscriptionEvents, users } from '../db/schema.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';
import { verifyMpSignature } from '../lib/mp-signature.ts';
import { type UserUpdate, periodEnd, updateFromPreapproval, userIdFromReference } from '../lib/preapproval.ts';
import { type RateLimitRule, clientIp, rateLimit } from '../lib/rate-limit.ts';

type Options = {
  db: Db;
  mp: MercadoPago;
  webhookSecret: string;
  limit: RateLimitRule;
};

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

export function webhookRoutes({ db, mp, webhookSecret, limit }: Options) {
  const app = new Hono();
  // Antes de validar la firma: frena el spam antes de gastar HMAC y consultas a MP.
  app.use(rateLimit(limit, clientIp));

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

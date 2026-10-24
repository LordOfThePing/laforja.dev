import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { subscriptionEvents, users } from '../db/schema.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';
import { verifyMpSignature } from '../lib/mp-signature.ts';
import { type UserUpdate, periodEnd, updateFromPreapproval, userIdFromReference } from '../lib/preapproval.ts';
import { type LemonSqueezy, verifyLemonSignature } from '../lib/lemonsqueezy.ts';
import { type VariantPlans, parseCustomData, updateFromSubscription } from '../lib/lemonsqueezy-sync.ts';
import { type RateLimitRule, clientIp, rateLimit } from '../lib/rate-limit.ts';

type Options = {
  db: Db;
  mp: MercadoPago;
  webhookSecret: string;
  limit: RateLimitRule;
  lemon?: {
    client: LemonSqueezy;
    webhookSecret: string;
    variantPlans: VariantPlans;
  };
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

// Todos los subscription_* traen la suscripción en data, pero se vuelve a pedir a LS: los webhooks
// pueden llegar desordenados y así se aplica siempre el estado vigente. Los de pagos
// (subscription_payment_*) se ignoran: cada cobro dispara además un subscription_updated.
const LEMON_SUBSCRIPTION_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
]);

type LemonEvent = {
  meta?: { event_name?: string; custom_data?: unknown };
  data?: { type?: string; id?: string | number };
};

export function webhookRoutes({ db, mp, webhookSecret, limit, lemon }: Options) {
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

    const rawId = body.id !== undefined ? String(body.id) : `${type}:${dataId}:${requestId}`;
    const providerEventId = `mp:${rawId}`;

    const [seen] = await db
      .select({ id: subscriptionEvents.id })
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.providerEventId, providerEventId))
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
        .values({ providerEventId, eventType: type ?? 'unknown', userId: owner?.id ?? null, payload: body })
        .onConflictDoNothing()
        .returning({ id: subscriptionEvents.id });
      if (inserted.length === 0) return 'duplicate';
      if (update) await tx.update(users).set(update.set).where(update.where);
      return 'processed';
    });

    return c.json({ status });
  });

  if (lemon) {
    app.post('/lemonsqueezy', async (c) => {
      // LS firma el raw body: hay que leerlo antes de parsear.
      const rawBody = await c.req.text();
      const valid = verifyLemonSignature({
        secret: lemon.webhookSecret,
        header: c.req.header('x-signature'),
        payload: rawBody,
      });
      if (!valid) return c.json({ error: 'invalid_signature' }, 401);

      let event: LemonEvent;
      try {
        event = JSON.parse(rawBody) as LemonEvent;
      } catch {
        return c.json({ error: 'invalid_payload' }, 400);
      }
      const eventName = event.meta?.event_name;
      if (!eventName) return c.json({ error: 'invalid_payload' }, 400);

      // LS no manda un id de evento; los reintentos repiten el body tal cual, así que su hash sirve.
      const providerEventId = `ls:${createHash('sha256').update(rawBody).digest('hex')}`;

      const [seen] = await db
        .select({ id: subscriptionEvents.id })
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.providerEventId, providerEventId))
        .limit(1);
      if (seen) return c.json({ status: 'duplicate' });

      const { userId, plan } = parseCustomData(event.meta?.custom_data);
      const subscriptionId = event.data?.type === 'subscriptions' && event.data.id !== undefined ? String(event.data.id) : null;
      // Igual que MP: consultar fuera de la transacción. Si LS falla respondemos 502 sin registrar el
      // evento y el reintento de LS lo reprocesa.
      const update =
        LEMON_SUBSCRIPTION_EVENTS.has(eventName) && subscriptionId
          ? updateFromSubscription(await lemon.client.getSubscription(subscriptionId), {
              userId,
              plan,
              variantPlans: lemon.variantPlans,
            })
          : null;

      const status = await db.transaction(async (tx) => {
        const [owner] = userId
          ? await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))
          : [];
        const inserted = await tx
          .insert(subscriptionEvents)
          .values({ providerEventId, eventType: eventName, userId: owner?.id ?? null, payload: event })
          .onConflictDoNothing()
          .returning({ id: subscriptionEvents.id });
        if (inserted.length === 0) return 'duplicate';
        if (update) await tx.update(users).set(update.set).where(update.where);
        return 'processed';
      });

      return c.json({ status });
    });
  }

  return app;
}

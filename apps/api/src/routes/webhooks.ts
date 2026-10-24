import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { subscriptionEvents, users } from '../db/schema.ts';
import type { MercadoPago } from '../lib/mercadopago.ts';
import { verifyMpSignature } from '../lib/mp-signature.ts';
import { type UserUpdate, periodEnd, updateFromPreapproval, userIdFromReference } from '../lib/preapproval.ts';
import { type RateLimitRule, clientIp, rateLimit } from '../lib/rate-limit.ts';
import type { Stripe, StripeEvent, StripeSubscription } from '../lib/stripe.ts';
import { verifyStripeSignature } from '../lib/stripe.ts';
import { type UserUpdate as StripeUserUpdate, updateFromSubscription } from '../lib/stripe-sync.ts';
import type { Plan } from './subscription.ts';

type Options = {
  db: Db;
  mp: MercadoPago;
  webhookSecret: string;
  limit: RateLimitRule;
  stripe?: {
    client: Stripe;
    webhookSecret: string;
    prices: Record<Plan, string>;
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

// Resuelve el update a aplicar a `users` según el evento de Stripe. checkout.session.completed
// trae la session en data.object: hay que ir a buscar la subscription para tener current_period_end
// y el price_id. subscription.updated/deleted ya traen la subscription entera en data.object.
async function resolveStripeUpdate(
  stripe: Stripe,
  prices: Record<Plan, string>,
  event: StripeEvent,
): Promise<StripeUserUpdate | null> {
  const priceToPlan: Record<string, Plan> = { [prices.basic]: 'basic', [prices.pro]: 'pro' };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      subscription?: string | null;
      mode?: string;
    };
    if (session.mode !== 'subscription' || !session.subscription) return null;
    const sub = await stripe.getSubscription(session.subscription);
    return updateFromSubscription(sub, priceToPlan);
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as unknown as StripeSubscription;
    return updateFromSubscription(sub, priceToPlan);
  }

  return null;
}

export function webhookRoutes({ db, mp, webhookSecret, limit, stripe }: Options) {
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

  if (stripe) {
    app.post('/stripe', async (c) => {
      // Stripe firma el raw body: hay que leerlo antes de parsear.
      const rawBody = await c.req.text();
      const valid = await verifyStripeSignature({
        secret: stripe.webhookSecret,
        header: c.req.header('stripe-signature'),
        payload: rawBody,
      });
      if (!valid) return c.json({ error: 'invalid_signature' }, 401);

      let event: StripeEvent;
      try {
        event = JSON.parse(rawBody) as StripeEvent;
      } catch {
        return c.json({ error: 'invalid_payload' }, 400);
      }
      if (!event.id || !event.type) return c.json({ error: 'invalid_payload' }, 400);

      const providerEventId = `stripe:${event.id}`;

      const [seen] = await db
        .select({ id: subscriptionEvents.id })
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.providerEventId, providerEventId))
        .limit(1);
      if (seen) return c.json({ status: 'duplicate' });

      // Igual que MP: resolver fuera de la transacción. Si Stripe falla al traer la subscription
      // respondemos 500 y el reintento de Stripe lo reprocesa.
      const update = await resolveStripeUpdate(stripe.client, stripe.prices, event);

      const status = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(subscriptionEvents)
          .values({ providerEventId, eventType: event.type, userId: null, payload: event })
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

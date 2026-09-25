import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from './db/client.ts';
import { type MercadoPago, MercadoPagoError } from './lib/mercadopago.ts';
import { meRoutes } from './routes/me.ts';
import { subscriptionRoutes } from './routes/subscription.ts';
import { toolsRoutes } from './routes/tools.ts';
import { webhookRoutes } from './routes/webhooks.ts';

type AppOptions = {
  db: Db;
  authSecret: string;
  frontendUrl: string;
  mp: MercadoPago;
  mpWebhookSecret: string;
  log?: boolean;
};

export function createApp({
  db,
  authSecret,
  frontendUrl,
  mp,
  mpWebhookSecret,
  log = true,
}: AppOptions) {
  const app = new Hono();

  if (log) app.use(logger());
  app.use('/api/*', cors({ origin: frontendUrl, credentials: true }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api/tools', toolsRoutes(db, authSecret));
  app.route('/api/me', meRoutes(db, authSecret));
  app.route('/api/subscription', subscriptionRoutes({ db, authSecret, frontendUrl, mp }));
  app.route('/webhooks', webhookRoutes({ db, mp, webhookSecret: mpWebhookSecret }));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    if (err instanceof MercadoPagoError) return c.json({ error: 'payment_provider_error' }, 502);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

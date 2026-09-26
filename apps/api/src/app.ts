import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from './db/client.ts';
import { type MercadoPago, MercadoPagoError } from './lib/mercadopago.ts';
import type { RateLimitRule } from './lib/rate-limit.ts';
import type { AuthConfig } from './auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { meRoutes } from './routes/me.ts';
import { subscriptionRoutes } from './routes/subscription.ts';
import { toolsRoutes } from './routes/tools.ts';
import { webhookRoutes } from './routes/webhooks.ts';

type AppOptions = {
  db: Db;
  authSecret: string;
  adminEmails?: ReadonlySet<string>;
  frontendUrl: string;
  mp: MercadoPago;
  mpWebhookSecret: string;
  rateLimits?: Partial<RateLimits>;
  log?: boolean;
};

type RateLimits = { unlock: RateLimitRule; webhook: RateLimitRule };

// Unlock: por usuario; el cupo ya acota las escrituras, esto frena el martilleo.
// Webhook: por IP y generoso, porque MP manda ráfagas legítimas desde pocas IPs.
const DEFAULT_RATE_LIMITS: RateLimits = {
  unlock: { limit: 10, windowMs: 60_000 },
  webhook: { limit: 300, windowMs: 60_000 },
};

export function createApp({
  db,
  authSecret,
  adminEmails = new Set(),
  frontendUrl,
  mp,
  mpWebhookSecret,
  rateLimits,
  log = true,
}: AppOptions) {
  const app = new Hono();
  const limits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  const auth: AuthConfig = { db, secret: authSecret, adminEmails };

  if (log) app.use(logger());
  app.use('/api/*', cors({ origin: frontendUrl, credentials: true }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api/tools', toolsRoutes(auth, limits.unlock));
  app.route('/api/me', meRoutes(auth));
  app.route('/api/subscription', subscriptionRoutes({ auth, frontendUrl, mp }));
  app.route('/api/admin', adminRoutes(auth));
  app.route('/webhooks', webhookRoutes({ db, mp, webhookSecret: mpWebhookSecret, limit: limits.webhook }));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    if (err instanceof MercadoPagoError) return c.json({ error: 'payment_provider_error' }, 502);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

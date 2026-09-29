import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { env } from './env.ts';
import { createResendMailer } from './lib/mailer.ts';
import { createMercadoPago } from './lib/mercadopago.ts';
import { startReconciler } from './reconcile.ts';

const { db } = createDb(env.databaseUrl);
const mp = createMercadoPago(env.mpAccessToken);
const app = createApp({
  db,
  authSecret: env.authSecret,
  adminEmails: env.adminEmails,
  frontendUrl: env.frontendUrl,
  mp,
  mpWebhookSecret: env.mpWebhookSecret,
  mpBackUrl: env.mpBackUrl,
  mailer: env.resendApiKey ? createResendMailer(env.resendApiKey, env.newsletterFrom) : null,
  backupStateDir: env.backupStateDir,
});

if (env.reconcileIntervalHours > 0) {
  startReconciler(db, mp, env.reconcileIntervalHours * 60 * 60 * 1000);
}

export default {
  port: env.port,
  fetch: app.fetch,
};

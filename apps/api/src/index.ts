import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { env } from './env.ts';
import { createResendMailer } from './lib/mailer.ts';
import { createMercadoPago } from './lib/mercadopago.ts';
import { createLemonSqueezy } from './lib/lemonsqueezy.ts';
import { variantPlans } from './lib/lemonsqueezy-sync.ts';
import { startReconciler } from './reconcile.ts';

const { db } = createDb(env.databaseUrl);
const mp = createMercadoPago(env.mpAccessToken);

// Lemon Squeezy queda apagado si falta alguna de sus variables (env.lemon undefined): el frontend no
// muestra el toggle internacional y el endpoint responde 503 si alguien lo pide igual.
const lemon = env.lemon
  ? {
      client: createLemonSqueezy({ apiKey: env.lemon.apiKey, storeId: env.lemon.storeId }),
      webhookSecret: env.lemon.webhookSecret,
      variants: env.lemon.variants,
    }
  : undefined;

const app = createApp({
  db,
  authSecret: env.authSecret,
  adminEmails: env.adminEmails,
  frontendUrl: env.frontendUrl,
  mp,
  mpWebhookSecret: env.mpWebhookSecret,
  lemon,
  mailer: env.resendApiKey ? createResendMailer(env.resendApiKey, env.newsletterFrom) : null,
  backupStateDir: env.backupStateDir,
  mcpAdminToken: env.mcpAdminToken,
});

if (env.reconcileIntervalHours > 0) {
  startReconciler(
    db,
    { mp, lemon: lemon ? { client: lemon.client, variantPlans: variantPlans(lemon.variants) } : undefined },
    env.reconcileIntervalHours * 60 * 60 * 1000,
  );
}

export default {
  port: env.port,
  fetch: app.fetch,
};

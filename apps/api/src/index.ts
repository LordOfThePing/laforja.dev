import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { env } from './env.ts';
import { createResendMailer } from './lib/mailer.ts';
import { createMercadoPago } from './lib/mercadopago.ts';
import { createStripe } from './lib/stripe.ts';
import { startReconciler } from './reconcile.ts';

const { db } = createDb(env.databaseUrl);
const mp = createMercadoPago(env.mpAccessToken);

// Stripe queda apagado si falta alguna de sus cuatro variables: el frontend no muestra el toggle
// internacional y el endpoint responde 503 si alguien lo pide igual.
const stripeConfig =
  env.stripeSecretKey && env.stripeWebhookSecret && env.stripePriceBasic && env.stripePricePro
    ? {
        client: createStripe(env.stripeSecretKey),
        webhookSecret: env.stripeWebhookSecret,
        prices: { basic: env.stripePriceBasic, pro: env.stripePricePro },
      }
    : undefined;

const app = createApp({
  db,
  authSecret: env.authSecret,
  adminEmails: env.adminEmails,
  frontendUrl: env.frontendUrl,
  mp,
  mpWebhookSecret: env.mpWebhookSecret,
  stripe: stripeConfig,
  mailer: env.resendApiKey ? createResendMailer(env.resendApiKey, env.newsletterFrom) : null,
  backupStateDir: env.backupStateDir,
  mcpAdminToken: env.mcpAdminToken,
});

if (env.reconcileIntervalHours > 0) {
  startReconciler(
    db,
    { mp, stripe: stripeConfig ? { client: stripeConfig.client, prices: stripeConfig.prices } : undefined },
    env.reconcileIntervalHours * 60 * 60 * 1000,
  );
}

export default {
  port: env.port,
  fetch: app.fetch,
};

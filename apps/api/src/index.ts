import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { env } from './env.ts';
import { createMercadoPago } from './lib/mercadopago.ts';

const { db } = createDb(env.databaseUrl);
const app = createApp({
  db,
  authSecret: env.authSecret,
  frontendUrl: env.frontendUrl,
  mp: createMercadoPago(env.mpAccessToken),
  mpWebhookSecret: env.mpWebhookSecret,
});

export default {
  port: env.port,
  fetch: app.fetch,
};

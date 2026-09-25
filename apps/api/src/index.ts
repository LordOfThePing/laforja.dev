import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { env } from './env.ts';

const { db } = createDb(env.databaseUrl);
const app = createApp({ db, frontendUrl: env.frontendUrl });

export default {
  port: env.port,
  fetch: app.fetch,
};

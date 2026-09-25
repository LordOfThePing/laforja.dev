import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from './db/client.ts';
import { toolsRoutes } from './routes/tools.ts';

type AppOptions = {
  db: Db;
  frontendUrl: string;
  log?: boolean;
};

export function createApp({ db, frontendUrl, log = true }: AppOptions) {
  const app = new Hono();

  if (log) app.use(logger());
  app.use('/api/*', cors({ origin: frontendUrl, credentials: true }));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api/tools', toolsRoutes(db));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

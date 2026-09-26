import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sign } from 'hono/jwt';
import { createApp } from '../app.ts';
import type { RateLimitRule } from '../lib/rate-limit.ts';
import { JWT_AUDIENCE } from '../auth.ts';
import type { Db } from '../db/client.ts';
import * as schema from '../db/schema.ts';
import { seed } from '../db/seed-data.ts';
import { FakeMercadoPago } from './fake-mp.ts';

export const TEST_SECRET = 'secreto-de-test';
export const TEST_MP_WEBHOOK_SECRET = 'secreto-webhook-mp';
export const TEST_ADMIN_EMAIL = 'admin@example.com';

export async function createTestApp(
  rateLimits?: Partial<{ unlock: RateLimitRule; webhook: RateLimitRule; progress: RateLimitRule }>,
) {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: './drizzle' });
  const db = pg as unknown as Db;
  await seed(db);
  const mp = new FakeMercadoPago();
  const app = createApp({
    db,
    authSecret: TEST_SECRET,
    adminEmails: new Set([TEST_ADMIN_EMAIL]),
    frontendUrl: 'http://localhost:3000',
    mp,
    mpWebhookSecret: TEST_MP_WEBHOOK_SECRET,
    rateLimits,
    log: false,
  });
  return { app, db, mp };
}

export function makeToken(
  claims: Record<string, unknown> = {},
  secret: string = TEST_SECRET,
): Promise<string> {
  return sign(
    {
      sub: 'google-123',
      email: 'ana@example.com',
      name: 'Ana',
      picture: 'https://example.com/ana.png',
      aud: JWT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    },
    secret,
    'HS256',
  );
}

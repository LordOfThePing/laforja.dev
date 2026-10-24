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
import { FakeMailer } from './fake-mailer.ts';
import { FakeMercadoPago } from './fake-mp.ts';
import { FakeLemonSqueezy, TEST_LS_VARIANTS } from './fake-lemonsqueezy.ts';

export const TEST_SECRET = 'secreto-de-test';
export const TEST_MP_WEBHOOK_SECRET = 'secreto-webhook-mp';
export const TEST_ADMIN_EMAIL = 'admin@example.com';
export const TEST_MCP_TOKEN = 'secreto-mcp-token';
export const TEST_LS_WEBHOOK_SECRET = 'secreto-webhook-ls';

export async function createTestApp(
  rateLimits?: Partial<{
    unlock: RateLimitRule;
    webhook: RateLimitRule;
    progress: RateLimitRule;
    comment: RateLimitRule;
    newsletter: RateLimitRule;
  }>,
  backupStateDir?: string,
  mailer: FakeMailer | null = new FakeMailer(),
  // lemon: true monta Lemon Squeezy con un fake; sin eso queda apagado, como en prod sin variables.
  overrides: { mcpAdminToken?: string; lemon?: boolean } = {},
) {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: './drizzle' });
  const db = pg as unknown as Db;
  await seed(db);
  const mp = new FakeMercadoPago();
  const lemon = overrides.lemon ? new FakeLemonSqueezy() : undefined;
  const app = createApp({
    db,
    authSecret: TEST_SECRET,
    adminEmails: new Set([TEST_ADMIN_EMAIL]),
    frontendUrl: 'http://localhost:3000',
    mp,
    mpWebhookSecret: TEST_MP_WEBHOOK_SECRET,
    lemon: lemon ? { client: lemon, webhookSecret: TEST_LS_WEBHOOK_SECRET, variants: TEST_LS_VARIANTS } : undefined,
    rateLimits,
    backupStateDir,
    mailer,
    mcpAdminToken: overrides.mcpAdminToken,
    log: false,
  });
  return { app, db, mp, mailer, lemon };
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

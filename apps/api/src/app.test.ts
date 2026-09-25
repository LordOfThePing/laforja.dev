import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { seed, seedTools } from './db/seed-data.ts';

let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: './drizzle' });
  db = pg as unknown as Db;
  await seed(db);
  await seed(db);
  app = createApp({ db, frontendUrl: 'http://localhost:3000', log: false });
});

describe('GET /health', () => {
  test('responde ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /api/tools', () => {
  test('lista las herramientas publicadas en el orden del seed, sin contenido gated', async () => {
    const res = await app.request('/api/tools');
    expect(res.status).toBe(200);
    const { tools } = (await res.json()) as { tools: Record<string, unknown>[] };

    expect(tools.map((t) => t.slug)).toEqual(seedTools.map((t) => t.slug));
    for (const tool of tools) {
      expect(tool).not.toHaveProperty('promptBody');
      expect(tool.isLocked).toBe(tool.tier === 'premium');
    }
    expect(tools[0]?.category).toEqual({ slug: 'prompts', name: 'Prompts' });
  });

  test('no lista herramientas sin publicar', async () => {
    await db
      .update(schema.tools)
      .set({ publishedAt: null })
      .where(eq(schema.tools.slug, 'prompt-debug'));
    const res = await app.request('/api/tools');
    const { tools } = (await res.json()) as { tools: { slug: string }[] };
    expect(tools.some((t) => t.slug === 'prompt-debug')).toBe(false);

    const detail = await app.request('/api/tools/prompt-debug');
    expect(detail.status).toBe(404);
    await seed(db);
  });
});

describe('GET /api/tools/:slug', () => {
  test('free: devuelve el prompt', async () => {
    const res = await app.request('/api/tools/meta-prompt-arquitecto');
    expect(res.status).toBe(200);
    const { tool } = (await res.json()) as { tool: Record<string, unknown> };
    expect(tool.isLocked).toBe(false);
    expect(typeof tool.promptBody).toBe('string');
  });

  test('premium: devuelve solo el preview', async () => {
    const res = await app.request('/api/tools/code-review-agentico');
    expect(res.status).toBe(200);
    const { tool } = (await res.json()) as { tool: Record<string, unknown> };
    expect(tool.isLocked).toBe(true);
    expect(tool).not.toHaveProperty('promptBody');
    expect(tool).not.toHaveProperty('youtubeUrl');
    expect(tool).not.toHaveProperty('longDescription');
  });

  test('slug inexistente: 404', async () => {
    const res = await app.request('/api/tools/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

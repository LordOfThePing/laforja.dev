import { beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { unlocks, users } from './db/schema.ts';
import { monthKey } from './lib/month.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

let userSeq = 0;
async function newUser() {
  userSeq += 1;
  const token = await makeToken({ sub: `google-u${userSeq}`, email: `u${userSeq}@example.com` });
  const me = (await (await get('/api/me', token)).json()) as { user: { id: string } };
  return { token, id: me.user.id };
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

function unlock(slug: string, token?: string) {
  return app.request(`/api/tools/${slug}/unlock`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

type ToolBody = { tool: Record<string, unknown>; unlocks: { used: number; remaining: number } };

async function countUnlocks(userId: string) {
  const rows = await db
    .select()
    .from(unlocks)
    .where(and(eq(unlocks.userId, userId), eq(unlocks.monthKey, monthKey())));
  return rows.length;
}

describe('POST /api/tools/:slug/unlock', () => {
  test('sin auth: 401', async () => {
    expect((await unlock('code-review-agentico')).status).toBe(401);
  });

  test('slug inexistente: 404', async () => {
    const { token } = await newUser();
    expect((await unlock('no-existe', token)).status).toBe(404);
  });

  test('premium con cupo: 201, devuelve el contenido y consume cupo', async () => {
    const { token, id } = await newUser();
    const res = await unlock('code-review-agentico', token);
    expect(res.status).toBe(201);
    const body = (await res.json()) as ToolBody;
    expect(body.tool.isLocked).toBe(false);
    expect(typeof body.tool.promptBody).toBe('string');
    expect(body.tool).not.toHaveProperty('id');
    expect(body.unlocks).toMatchObject({ used: 1, remaining: 1, limit: 2 });
    expect(await countUnlocks(id)).toBe(1);
  });

  test('repetir el unlock de la misma herramienta: 200, no consume cupo', async () => {
    const { token, id } = await newUser();
    await unlock('code-review-agentico', token);
    const res = await unlock('code-review-agentico', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ToolBody).unlocks.used).toBe(1);
    expect(await countUnlocks(id)).toBe(1);
  });

  test('tercera herramienta en el mes: 403 quota_exceeded', async () => {
    const { token, id } = await newUser();
    expect((await unlock('code-review-agentico', token)).status).toBe(201);
    expect((await unlock('prompt-editorial', token)).status).toBe(201);

    const res = await unlock('prompt-debug', token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: 'quota_exceeded',
      unlocks: { used: 2, remaining: 0 },
    });
    expect(await countUnlocks(id)).toBe(2);

    expect((await unlock('code-review-agentico', token)).status).toBe(200);
  });

  test('unlocks de meses anteriores no cuentan', async () => {
    const { token, id } = await newUser();
    const [t1, t2] = await db.query.tools.findMany({
      where: (t, { eq }) => eq(t.tier, 'premium'),
      limit: 2,
    });
    if (!t1 || !t2) throw new Error('faltan premium en el seed');
    await db.insert(unlocks).values([
      { userId: id, toolId: t1.id, monthKey: '2000-01' },
      { userId: id, toolId: t2.id, monthKey: '2000-01' },
    ]);
    expect((await unlock('prompt-debug', token)).status).toBe(201);
  });

  test('herramienta free: 200 sin consumir cupo', async () => {
    const { token, id } = await newUser();
    const res = await unlock('meta-prompt-arquitecto', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ToolBody).unlocks.used).toBe(0);
    expect(await countUnlocks(id)).toBe(0);
  });

  test('suscriptor: 200 sin consumir cupo, aunque ya haya usado los 2', async () => {
    const { token, id } = await newUser();
    await unlock('code-review-agentico', token);
    await unlock('prompt-editorial', token);
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) })
      .where(eq(users.id, id));

    expect((await unlock('prompt-debug', token)).status).toBe(200);
    expect(await countUnlocks(id)).toBe(2);
  });

  test('unlocks concurrentes no superan el cupo', async () => {
    const { token, id } = await newUser();
    const slugs = ['code-review-agentico', 'prompt-editorial', 'prompt-debug', 'evaluar-outputs'];
    const statuses = await Promise.all(slugs.map(async (s) => (await unlock(s, token)).status));
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 403)).toHaveLength(2);
    expect(await countUnlocks(id)).toBe(2);
  });
});

describe('isLocked según el usuario', () => {
  test('GET /api/tools con token: desbloqueadas este mes aparecen abiertas', async () => {
    const { token } = await newUser();
    await unlock('code-review-agentico', token);

    const res = await get('/api/tools', token);
    const { tools } = (await res.json()) as { tools: { slug: string; isLocked: boolean; tier: string }[] };
    const locked = Object.fromEntries(tools.map((t) => [t.slug, t.isLocked]));
    expect(locked['code-review-agentico']).toBe(false);
    expect(locked['meta-prompt-arquitecto']).toBe(false);
    expect(locked['prompt-editorial']).toBe(true);
  });

  test('GET /api/tools/:slug con token: desbloqueada devuelve el contenido', async () => {
    const { token } = await newUser();
    const before = (await (await get('/api/tools/prompt-editorial', token)).json()) as ToolBody;
    expect(before.tool.isLocked).toBe(true);
    expect(before.tool).not.toHaveProperty('promptBody');

    await unlock('prompt-editorial', token);
    const after = (await (await get('/api/tools/prompt-editorial', token)).json()) as ToolBody;
    expect(after.tool.isLocked).toBe(false);
    expect(typeof after.tool.promptBody).toBe('string');
  });

  test('suscriptor: todas abiertas', async () => {
    const { token, id } = await newUser();
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', currentPeriodEnd: null })
      .where(eq(users.id, id));
    const { tools } = (await (await get('/api/tools', token)).json()) as { tools: { isLocked: boolean }[] };
    expect(tools.every((t) => !t.isLocked)).toBe(true);
  });

  test('token inválido en endpoint público: 401', async () => {
    expect((await get('/api/tools', 'basura')).status).toBe(401);
  });

  test('sin token: premium bloqueadas', async () => {
    const { tools } = (await (await get('/api/tools')).json()) as {
      tools: { tier: string; isLocked: boolean }[];
    };
    expect(tools.every((t) => t.isLocked === (t.tier === 'premium'))).toBe(true);
  });
});

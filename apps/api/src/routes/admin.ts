import { and, asc, count, desc, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAdmin, requireAuth } from '../auth.ts';
import { categories, tools, unlocks, users } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import { isUuid, parseCategory, parseTool } from '../lib/admin-input.ts';
import { monthKey } from '../lib/month.ts';

const toolColumns = {
  id: tools.id,
  slug: tools.slug,
  title: tools.title,
  shortDescription: tools.shortDescription,
  longDescription: tools.longDescription,
  youtubeUrl: tools.youtubeUrl,
  promptBody: tools.promptBody,
  tier: tools.tier,
  categoryId: tools.categoryId,
  tags: tools.tags,
  durationSeconds: tools.durationSeconds,
  coverImageUrl: tools.coverImageUrl,
  publishedAt: tools.publishedAt,
  createdAt: tools.createdAt,
};

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

function invalid(c: Context, field: string) {
  return c.json({ error: 'invalid_input', field }, 400);
}

export function adminRoutes(auth: AuthConfig) {
  const { db } = auth;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(auth), requireAdmin);

  async function slugTaken(table: typeof tools | typeof categories, slug: string, exceptId?: string) {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(exceptId ? and(eq(table.slug, slug), ne(table.id, exceptId)) : eq(table.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  async function categoryExists(id: string) {
    const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id));
    return row !== undefined;
  }

  app.get('/stats', async (c) => {
    const [[usersRow], [subsRow], [unlocksRow], [toolsRow]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(users).where(eq(users.subscriptionStatus, 'active')),
      db.select({ n: count() }).from(unlocks).where(eq(unlocks.monthKey, monthKey())),
      db
        .select({
          total: count(),
          published: sql<number>`count(*) filter (where ${and(isNotNull(tools.publishedAt), lte(tools.publishedAt, sql`now()`))})`.mapWith(Number),
        })
        .from(tools),
    ]);
    return c.json({
      users: usersRow?.n ?? 0,
      activeSubscribers: subsRow?.n ?? 0,
      unlocksThisMonth: unlocksRow?.n ?? 0,
      tools: { total: toolsRow?.total ?? 0, published: toolsRow?.published ?? 0 },
    });
  });

  app.get('/tools', async (c) => {
    const rows = await db
      .select({ ...toolColumns, categoryName: categories.name })
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .orderBy(desc(tools.createdAt), tools.slug);
    return c.json({ tools: rows });
  });

  app.get('/tools/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [row] = await db.select(toolColumns).from(tools).where(eq(tools.id, id));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ tool: row });
  });

  app.post('/tools', async (c) => {
    const parsed = parseTool(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;
    if (!(await categoryExists(input.categoryId))) return invalid(c, 'categoryId');
    if (await slugTaken(tools, input.slug)) return c.json({ error: 'slug_taken' }, 409);

    const [row] = await db.insert(tools).values(input).returning(toolColumns);
    return c.json({ tool: row }, 201);
  });

  app.patch('/tools/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseTool(await readJson(c), true);
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;
    if (input.categoryId && !(await categoryExists(input.categoryId))) return invalid(c, 'categoryId');
    if (input.slug && (await slugTaken(tools, input.slug, id))) return c.json({ error: 'slug_taken' }, 409);
    if (Object.keys(input).length === 0) return invalid(c, 'body');

    const [row] = await db.update(tools).set(input).where(eq(tools.id, id)).returning(toolColumns);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ tool: row });
  });

  app.delete('/tools/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [row] = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.get('/categories', async (c) => {
    const rows = await db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        description: categories.description,
        order: categories.order,
        toolCount: sql<number>`(select count(*) from ${tools} where ${tools.categoryId} = ${categories.id})`.mapWith(Number),
      })
      .from(categories)
      .orderBy(asc(categories.order), categories.name);
    return c.json({ categories: rows });
  });

  app.post('/categories', async (c) => {
    const parsed = parseCategory(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    if (await slugTaken(categories, parsed.value.slug)) return c.json({ error: 'slug_taken' }, 409);
    const [row] = await db.insert(categories).values(parsed.value).returning();
    return c.json({ category: row }, 201);
  });

  app.patch('/categories/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseCategory(await readJson(c), true);
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;
    if (Object.keys(input).length === 0) return invalid(c, 'body');
    if (input.slug && (await slugTaken(categories, input.slug, id))) {
      return c.json({ error: 'slug_taken' }, 409);
    }
    const [row] = await db.update(categories).set(input).where(eq(categories.id, id)).returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ category: row });
  });

  app.delete('/categories/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [inUse] = await db.select({ id: tools.id }).from(tools).where(eq(tools.categoryId, id)).limit(1);
    if (inUse) return c.json({ error: 'category_in_use' }, 409);
    const [row] = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.get('/users', async (c) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        subscriptionStatus: users.subscriptionStatus,
        currentPeriodEnd: users.currentPeriodEnd,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(200);
    return c.json({
      users: rows.map((u) => ({ ...u, hasAccess: hasSubscriptionAccess(u) })),
    });
  });

  app.patch('/users/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const body = (await readJson(c)) as { role?: unknown } | null;
    const role = body?.role;
    if (role !== 'user' && role !== 'admin') return invalid(c, 'role');
    // Sin esto el único admin puede sacarse el rol y quedar nadie para devolvérselo.
    if (id === c.get('user').id && role !== 'admin') {
      return c.json({ error: 'cannot_demote_self' }, 409);
    }
    const [row] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, role: users.role });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ user: row });
  });

  return app;
}

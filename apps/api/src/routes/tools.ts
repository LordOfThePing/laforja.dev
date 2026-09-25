import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { categories, tools } from '../db/schema.ts';

const previewColumns = {
  slug: tools.slug,
  title: tools.title,
  shortDescription: tools.shortDescription,
  tier: tools.tier,
  tags: tools.tags,
  durationSeconds: tools.durationSeconds,
  coverImageUrl: tools.coverImageUrl,
  publishedAt: tools.publishedAt,
  category: {
    slug: categories.slug,
    name: categories.name,
  },
};

const isPublished = and(isNotNull(tools.publishedAt), lte(tools.publishedAt, sql`now()`));

// Sin auth todavía: solo las free son visibles. Cuando exista sesión, acá entra la regla de cupo mensual.
function isLocked(tier: 'free' | 'premium') {
  return tier !== 'free';
}

export function toolsRoutes(db: Db) {
  const app = new Hono();

  app.get('/', async (c) => {
    const rows = await db
      .select(previewColumns)
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .where(isPublished)
      .orderBy(desc(tools.publishedAt), tools.slug);

    return c.json({
      tools: rows.map((row) => ({ ...row, isLocked: isLocked(row.tier) })),
    });
  });

  app.get('/:slug', async (c) => {
    const [row] = await db
      .select({
        ...previewColumns,
        longDescription: tools.longDescription,
        youtubeUrl: tools.youtubeUrl,
        promptBody: tools.promptBody,
      })
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .where(and(eq(tools.slug, c.req.param('slug')), isPublished))
      .limit(1);

    if (!row) return c.json({ error: 'not_found' }, 404);

    const { longDescription, youtubeUrl, promptBody, ...preview } = row;
    if (isLocked(row.tier)) {
      return c.json({ tool: { ...preview, isLocked: true } });
    }
    return c.json({
      tool: { ...preview, isLocked: false, longDescription, youtubeUrl, promptBody },
    });
  });

  return app;
}

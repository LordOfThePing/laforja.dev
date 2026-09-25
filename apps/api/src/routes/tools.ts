import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthEnv, type OptionalAuthEnv, optionalAuth, requireAuth } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { categories, tools, unlocks, users } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import { monthKey } from '../lib/month.ts';
import { type RateLimitRule, rateLimit } from '../lib/rate-limit.ts';
import {
  FREE_UNLOCKS_PER_MONTH,
  type Viewer,
  canView,
  quotaSummary,
  unlockedToolIds,
} from '../lib/unlocks.ts';

const previewColumns = {
  id: tools.id,
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

const detailColumns = {
  ...previewColumns,
  longDescription: tools.longDescription,
  youtubeUrl: tools.youtubeUrl,
  promptBody: tools.promptBody,
};

const isPublished = and(isNotNull(tools.publishedAt), lte(tools.publishedAt, sql`now()`));

function presentPreview<T extends { id: string }>({ id: _id, ...rest }: T, isLocked: boolean) {
  return { ...rest, isLocked };
}

function presentDetail<
  T extends { id: string; longDescription: unknown; youtubeUrl: unknown; promptBody: unknown },
>(row: T, viewable: boolean) {
  const { longDescription, youtubeUrl, promptBody, ...preview } = row;
  if (!viewable) return presentPreview(preview, true);
  return { ...presentPreview(preview, false), longDescription, youtubeUrl, promptBody };
}

async function loadViewer(db: Db, user: Viewer['user']): Promise<Viewer> {
  if (!user) return { user: null, unlockedToolIds: new Set() };
  return { user, unlockedToolIds: await unlockedToolIds(db, user.id, monthKey()) };
}

export function toolsRoutes(db: Db, authSecret: string, unlockLimit: RateLimitRule) {
  const app = new Hono<OptionalAuthEnv>();

  function findPublished(slug: string) {
    return db
      .select(detailColumns)
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .where(and(eq(tools.slug, slug), isPublished))
      .limit(1)
      .then((rows) => rows[0]);
  }

  app.get('/', optionalAuth(db, authSecret), async (c) => {
    const viewer = await loadViewer(db, c.get('user'));
    const rows = await db
      .select(previewColumns)
      .from(tools)
      .innerJoin(categories, eq(tools.categoryId, categories.id))
      .where(isPublished)
      .orderBy(desc(tools.publishedAt), tools.slug);

    return c.json({
      tools: rows.map((row) => presentPreview(row, !canView(row, viewer))),
    });
  });

  app.get('/:slug', optionalAuth(db, authSecret), async (c) => {
    const row = await findPublished(c.req.param('slug'));
    if (!row) return c.json({ error: 'not_found' }, 404);

    const viewer = await loadViewer(db, c.get('user'));
    return c.json({ tool: presentDetail(row, canView(row, viewer)) });
  });

  app.post(
    '/:slug/unlock',
    requireAuth(db, authSecret),
    rateLimit<AuthEnv>(unlockLimit, (c) => c.get('user').id),
    async (c) => {
      const user = c.get('user');
      const row = await findPublished(c.req.param('slug'));
      if (!row) return c.json({ error: 'not_found' }, 404);

      const month = monthKey();
      const result = await db.transaction(async (tx) => {
        // Lock sobre la fila del usuario: sin esto, dos unlocks concurrentes de herramientas
        // distintas leen el mismo conteo y ambos pasan, dejando al usuario con 3 en el mes.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');

        const unlocked = await unlockedToolIds(tx, user.id, month);

        if (row.tier === 'free' || hasSubscriptionAccess(user) || unlocked.has(row.id)) {
          return { ok: true as const, used: unlocked.size, created: false };
        }
        if (unlocked.size >= FREE_UNLOCKS_PER_MONTH) {
          return { ok: false as const, used: unlocked.size };
        }

        await tx
          .insert(unlocks)
          .values({ userId: user.id, toolId: row.id, monthKey: month })
          .onConflictDoNothing();
        return { ok: true as const, used: unlocked.size + 1, created: true };
      });

      const quota = { monthKey: month, ...quotaSummary(result.used) };
      if (!result.ok) {
        return c.json({ error: 'quota_exceeded', unlocks: quota }, 403);
      }
      return c.json(
        { tool: presentDetail(row, true), unlocks: quota },
        result.created ? 201 : 200,
      );
    },
  );

  return app;
}

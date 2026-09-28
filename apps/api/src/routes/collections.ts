import { and, asc, count, desc, eq, inArray, isNotNull, lte, sql, sum } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type OptionalAuthEnv, optionalAuth } from '../auth.ts';
import { categories, collectionItems, collections, courses, lessons, progress, tools } from '../db/schema.ts';
import { monthKey } from '../lib/month.ts';
import { canView, unlockedToolIds } from '../lib/unlocks.ts';

const published = (column: typeof collections.publishedAt | typeof tools.publishedAt | typeof courses.publishedAt) =>
  and(isNotNull(column), lte(column, sql`now()`));

const collectionColumns = {
  id: collections.id,
  slug: collections.slug,
  title: collections.title,
  shortDescription: collections.shortDescription,
  coverImageUrl: collections.coverImageUrl,
  publishedAt: collections.publishedAt,
};

// Un ítem cuya herramienta o curso no está publicado no se muestra: la ruta se puede armar
// antes de publicar su contenido.
const itemIsVisible = sql`(${collectionItems.toolId} is not null and ${published(tools.publishedAt)})
  or (${collectionItems.courseId} is not null and ${published(courses.publishedAt)})`;

export function collectionsRoutes(auth: AuthConfig) {
  const { db } = auth;
  const app = new Hono<OptionalAuthEnv>();

  app.get('/', async (c) => {
    const rows = await db
      .select({
        ...collectionColumns,
        toolCount: sql<number>`count(${collectionItems.toolId}) filter (where ${itemIsVisible})`.mapWith(Number),
        courseCount: sql<number>`count(${collectionItems.courseId}) filter (where ${itemIsVisible})`.mapWith(Number),
      })
      .from(collections)
      .leftJoin(collectionItems, eq(collectionItems.collectionId, collections.id))
      .leftJoin(tools, eq(collectionItems.toolId, tools.id))
      .leftJoin(courses, eq(collectionItems.courseId, courses.id))
      .where(published(collections.publishedAt))
      .groupBy(collections.id)
      .orderBy(asc(collections.order), desc(collections.publishedAt), asc(collections.slug));
    return c.json({
      collections: rows.filter((r) => r.toolCount + r.courseCount > 0).map(({ id: _id, ...r }) => r),
    });
  });

  app.get('/:slug', optionalAuth(auth), async (c) => {
    const user = c.get('user');
    const [collection] = await db
      .select({ ...collectionColumns, description: collections.description })
      .from(collections)
      .where(and(eq(collections.slug, c.req.param('slug')), published(collections.publishedAt)))
      .limit(1);
    if (!collection) return c.json({ error: 'not_found' }, 404);

    const items = await db
      .select({
        note: collectionItems.note,
        toolId: collectionItems.toolId,
        courseId: collectionItems.courseId,
        tool: {
          slug: tools.slug,
          title: tools.title,
          shortDescription: tools.shortDescription,
          tier: tools.tier,
          durationSeconds: tools.durationSeconds,
          coverImageUrl: tools.coverImageUrl,
          categoryName: categories.name,
        },
        course: {
          slug: courses.slug,
          title: courses.title,
          shortDescription: courses.shortDescription,
          tier: courses.tier,
          coverImageUrl: courses.coverImageUrl,
        },
      })
      .from(collectionItems)
      .leftJoin(tools, eq(collectionItems.toolId, tools.id))
      .leftJoin(categories, eq(tools.categoryId, categories.id))
      .leftJoin(courses, eq(collectionItems.courseId, courses.id))
      .where(and(eq(collectionItems.collectionId, collection.id), itemIsVisible))
      .orderBy(asc(collectionItems.order), asc(collectionItems.id));

    const courseIds = items.flatMap((i) => (i.courseId ? [i.courseId] : []));
    const [unlocked, lessonStats, completed] = await Promise.all([
      user ? unlockedToolIds(db, user.id, monthKey()) : Promise.resolve(new Set<string>()),
      courseIds.length
        ? db
            .select({ courseId: lessons.courseId, n: count(), seconds: sum(lessons.durationSeconds) })
            .from(lessons)
            .where(inArray(lessons.courseId, courseIds))
            .groupBy(lessons.courseId)
        : Promise.resolve([]),
      user && courseIds.length
        ? db
            .select({ courseId: lessons.courseId, n: count() })
            .from(progress)
            .innerJoin(lessons, eq(progress.lessonId, lessons.id))
            .where(
              and(eq(progress.userId, user.id), isNotNull(progress.completedAt), inArray(lessons.courseId, courseIds)),
            )
            .groupBy(lessons.courseId)
        : Promise.resolve([]),
    ]);
    const statsBy = new Map(lessonStats.map((r) => [r.courseId, r]));
    const completedBy = new Map(completed.map((r) => [r.courseId, r.n]));
    const viewer = { user, unlockedToolIds: unlocked };

    const presented = items.map((item) => {
      if (item.toolId && item.tool) {
        const { tier } = item.tool;
        return {
          kind: 'tool' as const,
          note: item.note,
          tool: { ...item.tool, isLocked: !canView({ id: item.toolId, tier: tier as 'free' | 'premium' }, viewer) },
        };
      }
      const courseId = item.courseId as string;
      const stats = statsBy.get(courseId);
      const lessonCount = stats?.n ?? 0;
      return {
        kind: 'course' as const,
        note: item.note,
        course: {
          ...item.course!,
          lessonCount,
          // sum() de Postgres vuelve como string (numeric) y null si no hay filas.
          durationSeconds: stats?.seconds == null ? 0 : Number(stats.seconds),
          progress: user ? { completed: completedBy.get(courseId) ?? 0, total: lessonCount } : null,
        },
      };
    });

    const courseItems = presented.flatMap((i) => (i.kind === 'course' ? [i.course] : []));
    const { id: _id, ...rest } = collection;
    return c.json({
      collection: {
        ...rest,
        items: presented,
        // Solo los cursos tienen un "terminado" medible; las herramientas no guardan progreso.
        progress:
          user && courseItems.length
            ? {
                coursesCompleted: courseItems.filter((co) => co.lessonCount > 0 && co.progress?.completed === co.lessonCount).length,
                courses: courseItems.length,
              }
            : null,
      },
    });
  });

  return app;
}

import { and, asc, count, desc, eq, inArray, isNotNull, lte, sql, sum } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  type AuthConfig,
  type AuthEnv,
  type AuthUser,
  type OptionalAuthEnv,
  optionalAuth,
  requireAuth,
} from '../auth.ts';
import { courses, lessons, modules, progress } from '../db/schema.ts';
import { canViewLesson, parseProgressInput } from '../lib/courses.ts';
import { type RateLimitRule, rateLimit } from '../lib/rate-limit.ts';

const isPublished = and(isNotNull(courses.publishedAt), lte(courses.publishedAt, sql`now()`));

const courseColumns = {
  id: courses.id,
  slug: courses.slug,
  title: courses.title,
  shortDescription: courses.shortDescription,
  coverImageUrl: courses.coverImageUrl,
  tier: courses.tier,
  publishedAt: courses.publishedAt,
};

type Course = { id: string; tier: 'free' | 'premium' };
type LessonRow = {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  durationSeconds: number | null;
  isFreePreview: boolean;
};
type ProgressRow = { lessonId: string; secondsWatched: number; completedAt: Date | null };

function presentProgress(p: ProgressRow | undefined) {
  return { secondsWatched: p?.secondsWatched ?? 0, completed: Boolean(p?.completedAt) };
}

export function coursesRoutes(auth: AuthConfig, progressLimit: RateLimitRule) {
  const { db } = auth;
  const app = new Hono<OptionalAuthEnv>();

  function findPublished(slug: string) {
    return db
      .select({ ...courseColumns, description: courses.description })
      .from(courses)
      .where(and(eq(courses.slug, slug), isPublished))
      .limit(1)
      .then((rows) => rows[0]);
  }

  // Módulo primero y lección después: el orden de lectura del temario.
  function syllabus(courseId: string) {
    return Promise.all([
      db
        .select({ id: modules.id, title: modules.title, description: modules.description })
        .from(modules)
        .where(eq(modules.courseId, courseId))
        .orderBy(asc(modules.order), asc(modules.id)),
      db
        .select({
          id: lessons.id,
          moduleId: lessons.moduleId,
          slug: lessons.slug,
          title: lessons.title,
          durationSeconds: lessons.durationSeconds,
          isFreePreview: lessons.isFreePreview,
          moduleOrder: modules.order,
        })
        .from(lessons)
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .where(eq(lessons.courseId, courseId))
        .orderBy(asc(modules.order), asc(modules.id), asc(lessons.order), asc(lessons.id)),
    ]);
  }

  async function progressFor(user: AuthUser | null, courseId: string) {
    if (!user) return new Map<string, ProgressRow>();
    const rows = await db
      .select({
        lessonId: progress.lessonId,
        secondsWatched: progress.secondsWatched,
        completedAt: progress.completedAt,
      })
      .from(progress)
      .innerJoin(lessons, eq(progress.lessonId, lessons.id))
      .where(and(eq(progress.userId, user.id), eq(lessons.courseId, courseId)));
    return new Map(rows.map((r) => [r.lessonId, r]));
  }

  async function findLesson(courseSlug: string, lessonSlug: string) {
    const course = await findPublished(courseSlug);
    if (!course) return null;
    const [, ordered] = await syllabus(course.id);
    const index = ordered.findIndex((l) => l.slug === lessonSlug);
    if (index === -1) return null;
    return { course, ordered, index, lesson: ordered[index] as LessonRow };
  }

  app.get('/', optionalAuth(auth), async (c) => {
    const user = c.get('user');
    const rows = await db
      .select(courseColumns)
      .from(courses)
      .where(isPublished)
      .orderBy(asc(courses.order), desc(courses.publishedAt), asc(courses.slug));
    if (rows.length === 0) return c.json({ courses: [] });
    const ids = rows.map((r) => r.id);

    const [moduleCounts, lessonStats, completed] = await Promise.all([
      db
        .select({ courseId: modules.courseId, n: count() })
        .from(modules)
        .where(inArray(modules.courseId, ids))
        .groupBy(modules.courseId),
      db
        .select({ courseId: lessons.courseId, n: count(), seconds: sum(lessons.durationSeconds) })
        .from(lessons)
        .where(inArray(lessons.courseId, ids))
        .groupBy(lessons.courseId),
      user
        ? db
            .select({ courseId: lessons.courseId, n: count() })
            .from(progress)
            .innerJoin(lessons, eq(progress.lessonId, lessons.id))
            .where(
              and(
                eq(progress.userId, user.id),
                isNotNull(progress.completedAt),
                inArray(lessons.courseId, ids),
              ),
            )
            .groupBy(lessons.courseId)
        : Promise.resolve([]),
    ]);
    const modulesBy = new Map(moduleCounts.map((r) => [r.courseId, r.n]));
    const lessonsBy = new Map(lessonStats.map((r) => [r.courseId, r]));
    const completedBy = new Map(completed.map((r) => [r.courseId, r.n]));

    return c.json({
      courses: rows.map(({ id, ...course }) => {
        const stats = lessonsBy.get(id);
        const lessonCount = stats?.n ?? 0;
        return {
          ...course,
          moduleCount: modulesBy.get(id) ?? 0,
          lessonCount,
          // sum() de Postgres vuelve como string (numeric) y null si no hay filas.
          durationSeconds: stats?.seconds == null ? 0 : Number(stats.seconds),
          progress: user ? { completed: completedBy.get(id) ?? 0, total: lessonCount } : null,
        };
      }),
    });
  });

  app.get('/:slug', optionalAuth(auth), async (c) => {
    const user = c.get('user');
    const course = await findPublished(c.req.param('slug'));
    if (!course) return c.json({ error: 'not_found' }, 404);

    const [[mods, ordered], prog] = await Promise.all([syllabus(course.id), progressFor(user, course.id)]);
    const lessonsByModule = Map.groupBy(ordered, (l) => l.moduleId);
    const { id: _id, ...rest } = course;

    return c.json({
      course: {
        ...rest,
        durationSeconds: ordered.reduce((acc, l) => acc + (l.durationSeconds ?? 0), 0),
        modules: mods.map(({ id, ...mod }) => ({
          ...mod,
          lessons: (lessonsByModule.get(id) ?? []).map((l) => ({
            slug: l.slug,
            title: l.title,
            durationSeconds: l.durationSeconds,
            isFreePreview: l.isFreePreview,
            isLocked: !canViewLesson(course, l, user),
            progress: user ? presentProgress(prog.get(l.id)) : null,
          })),
        })),
        progress: user
          ? {
              completed: ordered.filter((l) => prog.get(l.id)?.completedAt).length,
              total: ordered.length,
            }
          : null,
      },
    });
  });

  app.get('/:slug/lessons/:lesson', optionalAuth(auth), async (c) => {
    const user = c.get('user');
    const found = await findLesson(c.req.param('slug'), c.req.param('lesson'));
    if (!found) return c.json({ error: 'not_found' }, 404);
    const { course, ordered, index, lesson } = found;

    const viewable = canViewLesson(course, lesson, user);
    const [content, prog] = await Promise.all([
      viewable
        ? db
            .select({ youtubeUrl: lessons.youtubeUrl, contentMd: lessons.contentMd })
            .from(lessons)
            .where(eq(lessons.id, lesson.id))
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
      user ? progressFor(user, course.id) : Promise.resolve(new Map<string, ProgressRow>()),
    ]);

    const neighbour = (l: LessonRow | undefined) => (l ? { slug: l.slug, title: l.title } : null);
    const base = {
      slug: lesson.slug,
      title: lesson.title,
      durationSeconds: lesson.durationSeconds,
      isFreePreview: lesson.isFreePreview,
      course: { slug: course.slug, title: course.title, tier: course.tier },
      prev: neighbour(ordered[index - 1]),
      next: neighbour(ordered[index + 1]),
      progress: user ? presentProgress(prog.get(lesson.id)) : null,
    };
    return c.json({
      lesson: viewable
        ? { ...base, isLocked: false, youtubeUrl: content?.youtubeUrl ?? null, contentMd: content?.contentMd ?? null }
        : { ...base, isLocked: true },
    });
  });

  app.put(
    '/:slug/lessons/:lesson/progress',
    requireAuth(auth),
    rateLimit<AuthEnv>(progressLimit, (c) => c.get('user').id),
    async (c) => {
      const user = c.get('user');
      const input = parseProgressInput(await c.req.json().catch(() => null));
      if (!input) return c.json({ error: 'invalid_body' }, 400);

      const found = await findLesson(c.req.param('slug'), c.req.param('lesson'));
      if (!found) return c.json({ error: 'not_found' }, 404);
      if (!canViewLesson(found.course, found.lesson, user)) {
        return c.json({ error: 'subscription_required' }, 403);
      }

      // El progreso nunca retrocede por el reproductor: los segundos se quedan con el máximo
      // y completed_at conserva la primera vez. Solo un `completed: false` explícito lo borra.
      const completedOnConflict =
        input.completed === undefined
          ? {}
          : { completedAt: input.completed ? sql`coalesce(${progress.completedAt}, now())` : null };

      const [row] = await db
        .insert(progress)
        .values({
          userId: user.id,
          lessonId: found.lesson.id,
          secondsWatched: input.secondsWatched ?? 0,
          completedAt: input.completed ? sql`now()` : null,
        })
        .onConflictDoUpdate({
          target: [progress.userId, progress.lessonId],
          set: {
            secondsWatched: sql`greatest(${progress.secondsWatched}, excluded.seconds_watched)`,
            ...completedOnConflict,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          lessonId: progress.lessonId,
          secondsWatched: progress.secondsWatched,
          completedAt: progress.completedAt,
        });
      return c.json({ progress: presentProgress(row) });
    },
  );

  return app;
}

import { and, asc, desc, eq, max, ne, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { AuthEnv } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { courses, lessons, modules, progress } from '../db/schema.ts';
import { isUuid, parseCourse, parseDirection, parseLesson, parseModule } from '../lib/admin-input.ts';

const courseColumns = {
  id: courses.id,
  slug: courses.slug,
  title: courses.title,
  shortDescription: courses.shortDescription,
  description: courses.description,
  coverImageUrl: courses.coverImageUrl,
  tier: courses.tier,
  order: courses.order,
  publishedAt: courses.publishedAt,
  createdAt: courses.createdAt,
};

const lessonColumns = {
  id: lessons.id,
  moduleId: lessons.moduleId,
  courseId: lessons.courseId,
  slug: lessons.slug,
  title: lessons.title,
  youtubeUrl: lessons.youtubeUrl,
  contentMd: lessons.contentMd,
  durationSeconds: lessons.durationSeconds,
  order: lessons.order,
  isFreePreview: lessons.isFreePreview,
};

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

function invalid(c: Context, field: string) {
  return c.json({ error: 'invalid_input', field }, 400);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Renumera 1..n en el orden actual con `id` movido un lugar. Renumerar todo (en vez de
// swapear dos valores) arregla de paso empates o huecos que hayan quedado de antes.
export function reorder(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const i = ids.indexOf(id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= ids.length) return null;
  const out = [...ids];
  [out[i], out[j]] = [out[j] as string, out[i] as string];
  return out;
}

export function adminCourseRoutes(db: Db) {
  const app = new Hono<AuthEnv>();

  async function courseSlugTaken(slug: string, exceptId?: string) {
    const [row] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(exceptId ? and(eq(courses.slug, slug), ne(courses.id, exceptId)) : eq(courses.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  async function lessonSlugTaken(courseId: string, slug: string, exceptId?: string) {
    const bySlug = and(eq(lessons.courseId, courseId), eq(lessons.slug, slug));
    const [row] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(exceptId ? and(bySlug, ne(lessons.id, exceptId)) : bySlug)
      .limit(1);
    return row !== undefined;
  }

  function findModule(id: string) {
    return db
      .select({ id: modules.id, courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, id))
      .then((rows) => rows[0]);
  }

  async function nextLessonOrder(tx: Db | Tx, moduleId: string) {
    const [row] = await tx.select({ n: max(lessons.order) }).from(lessons).where(eq(lessons.moduleId, moduleId));
    return (row?.n ?? 0) + 1;
  }

  app.get('/courses', async (c) => {
    const rows = await db
      .select({
        ...courseColumns,
        // Drizzle no califica columnas cuando el select es de una sola tabla: `${courses.id}`
        // saldría como "id" y dentro de la subquery apuntaría al id de la tabla de adentro.
        moduleCount: sql<number>`(select count(*) from ${modules} m where m.course_id = ${courses}.id)`.mapWith(Number),
        lessonCount: sql<number>`(select count(*) from ${lessons} l where l.course_id = ${courses}.id)`.mapWith(Number),
      })
      .from(courses)
      .orderBy(asc(courses.order), desc(courses.createdAt));
    return c.json({ courses: rows });
  });

  app.post('/courses', async (c) => {
    const parsed = parseCourse(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    if (await courseSlugTaken(parsed.value.slug)) return c.json({ error: 'slug_taken' }, 409);
    const [row] = await db.insert(courses).values(parsed.value).returning(courseColumns);
    return c.json({ course: row }, 201);
  });

  app.get('/courses/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [course] = await db.select(courseColumns).from(courses).where(eq(courses.id, id));
    if (!course) return c.json({ error: 'not_found' }, 404);

    const [mods, rows, [learners]] = await Promise.all([
      db
        .select({ id: modules.id, title: modules.title, description: modules.description, order: modules.order })
        .from(modules)
        .where(eq(modules.courseId, id))
        .orderBy(asc(modules.order), asc(modules.id)),
      db
        .select({
          id: lessons.id,
          moduleId: lessons.moduleId,
          slug: lessons.slug,
          title: lessons.title,
          durationSeconds: lessons.durationSeconds,
          isFreePreview: lessons.isFreePreview,
          hasVideo: sql<boolean>`${lessons.youtubeUrl} is not null`,
          order: lessons.order,
        })
        .from(lessons)
        .where(eq(lessons.courseId, id))
        .orderBy(asc(lessons.order), asc(lessons.id)),
      db
        .select({ n: sql<number>`count(distinct ${progress.userId})`.mapWith(Number) })
        .from(progress)
        .innerJoin(lessons, eq(progress.lessonId, lessons.id))
        .where(eq(lessons.courseId, id)),
    ]);
    const byModule = Map.groupBy(rows, (l) => l.moduleId);
    return c.json({
      course: {
        ...course,
        learners: learners?.n ?? 0,
        modules: mods.map((m) => ({
          ...m,
          lessons: (byModule.get(m.id) ?? []).map(({ moduleId: _m, ...l }) => l),
        })),
      },
    });
  });

  app.patch('/courses/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseCourse(await readJson(c), true);
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;
    if (Object.keys(input).length === 0) return invalid(c, 'body');
    if (input.slug && (await courseSlugTaken(input.slug, id))) return c.json({ error: 'slug_taken' }, 409);
    const [row] = await db.update(courses).set(input).where(eq(courses.id, id)).returning(courseColumns);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ course: row });
  });

  app.delete('/courses/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [row] = await db.delete(courses).where(eq(courses.id, id)).returning({ id: courses.id });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.post('/courses/:id/modules', async (c) => {
    const courseId = c.req.param('id');
    if (!isUuid(courseId)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseModule(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!course) return c.json({ error: 'not_found' }, 404);
    const [last] = await db.select({ n: max(modules.order) }).from(modules).where(eq(modules.courseId, courseId));
    const [row] = await db
      .insert(modules)
      .values({ ...parsed.value, courseId, order: (last?.n ?? 0) + 1 })
      .returning();
    return c.json({ module: row }, 201);
  });

  app.patch('/modules/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseModule(await readJson(c), true);
    if (!parsed.ok) return invalid(c, parsed.field);
    if (Object.keys(parsed.value).length === 0) return invalid(c, 'body');
    const [row] = await db.update(modules).set(parsed.value).where(eq(modules.id, id)).returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ module: row });
  });

  app.delete('/modules/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [row] = await db.delete(modules).where(eq(modules.id, id)).returning({ id: modules.id });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.post('/modules/:id/move', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const direction = parseDirection(await readJson(c));
    if (!direction) return invalid(c, 'direction');
    const mod = await findModule(id);
    if (!mod) return c.json({ error: 'not_found' }, 404);

    await db.transaction(async (tx) => {
      const siblings = await tx
        .select({ id: modules.id })
        .from(modules)
        .where(eq(modules.courseId, mod.courseId))
        .orderBy(asc(modules.order), asc(modules.id))
        .for('update');
      const next = reorder(siblings.map((s) => s.id), id, direction);
      if (!next) return;
      for (const [i, sid] of next.entries()) {
        await tx.update(modules).set({ order: i + 1 }).where(eq(modules.id, sid));
      }
    });
    return c.body(null, 204);
  });

  app.post('/modules/:id/lessons', async (c) => {
    const moduleId = c.req.param('id');
    if (!isUuid(moduleId)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseLesson(await readJson(c));
    if (!parsed.ok) return invalid(c, parsed.field);
    const mod = await findModule(moduleId);
    if (!mod) return c.json({ error: 'not_found' }, 404);
    if (await lessonSlugTaken(mod.courseId, parsed.value.slug)) return c.json({ error: 'slug_taken' }, 409);
    const [row] = await db
      .insert(lessons)
      .values({ ...parsed.value, moduleId, courseId: mod.courseId, order: await nextLessonOrder(db, moduleId) })
      .returning(lessonColumns);
    return c.json({ lesson: row }, 201);
  });

  app.get('/lessons/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [row] = await db.select(lessonColumns).from(lessons).where(eq(lessons.id, id));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ lesson: row });
  });

  app.patch('/lessons/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = parseLesson(await readJson(c), true);
    if (!parsed.ok) return invalid(c, parsed.field);
    const input = parsed.value;
    if (Object.keys(input).length === 0) return invalid(c, 'body');

    const [current] = await db
      .select({ courseId: lessons.courseId, moduleId: lessons.moduleId })
      .from(lessons)
      .where(eq(lessons.id, id));
    if (!current) return c.json({ error: 'not_found' }, 404);
    if (input.slug && (await lessonSlugTaken(current.courseId, input.slug, id))) {
      return c.json({ error: 'slug_taken' }, 409);
    }

    let order: number | undefined;
    if (input.moduleId && input.moduleId !== current.moduleId) {
      const target = await findModule(input.moduleId);
      // Mover entre cursos rompería el progreso y el slug único: solo dentro del mismo curso.
      if (!target || target.courseId !== current.courseId) return invalid(c, 'moduleId');
      order = await nextLessonOrder(db, input.moduleId);
    }

    const [row] = await db
      .update(lessons)
      .set({ ...input, ...(order === undefined ? {} : { order }) })
      .where(eq(lessons.id, id))
      .returning(lessonColumns);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ lesson: row });
  });

  app.delete('/lessons/:id', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const [row] = await db.delete(lessons).where(eq(lessons.id, id)).returning({ id: lessons.id });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.post('/lessons/:id/move', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404);
    const direction = parseDirection(await readJson(c));
    if (!direction) return invalid(c, 'direction');
    const [lesson] = await db.select({ moduleId: lessons.moduleId }).from(lessons).where(eq(lessons.id, id));
    if (!lesson) return c.json({ error: 'not_found' }, 404);

    await db.transaction(async (tx) => {
      const siblings = await tx
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.moduleId, lesson.moduleId))
        .orderBy(asc(lessons.order), asc(lessons.id))
        .for('update');
      const next = reorder(siblings.map((s) => s.id), id, direction);
      if (!next) return;
      for (const [i, sid] of next.entries()) {
        await tx.update(lessons).set({ order: i + 1 }).where(eq(lessons.id, sid));
      }
    });
    return c.body(null, 204);
  });

  return app;
}

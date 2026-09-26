import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { courses, lessons, modules, progress, users } from './db/schema.ts';
import { seed } from './db/seed-data.ts';
import { TEST_ADMIN_EMAIL, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

let userSeq = 0;
async function newUser(claims: Record<string, unknown> = {}) {
  userSeq += 1;
  const token = await makeToken({
    sub: `google-c${userSeq}`,
    email: `c${userSeq}@example.com`,
    ...claims,
  });
  const me = (await (await get('/api/me', token)).json()) as { user: { id: string } };
  return { token, id: me.user.id };
}

async function newSubscriber() {
  const u = await newUser();
  await db
    .update(users)
    .set({ subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) })
    .where(eq(users.id, u.id));
  return u;
}

function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

function putProgress(course: string, lesson: string, body: unknown, token?: string) {
  return app.request(`/api/courses/${course}/lessons/${lesson}/progress`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const PREMIUM = 'agentes-de-punta-a-punta';
const FREE = 'prompting-desde-cero';

type ListBody = {
  courses: {
    slug: string;
    moduleCount: number;
    lessonCount: number;
    durationSeconds: number;
    progress: { completed: number; total: number } | null;
  }[];
};
type LessonSummary = {
  slug: string;
  isLocked: boolean;
  progress: { secondsWatched: number; completed: boolean } | null;
};
type DetailBody = {
  course: {
    slug: string;
    durationSeconds: number;
    modules: { title: string; lessons: LessonSummary[] }[];
    progress: { completed: number; total: number } | null;
  };
};
type LessonBody = {
  lesson: {
    slug: string;
    isLocked: boolean;
    youtubeUrl?: string | null;
    contentMd?: string | null;
    prev: { slug: string } | null;
    next: { slug: string } | null;
    progress: { secondsWatched: number; completed: boolean } | null;
  };
};

describe('GET /api/courses', () => {
  test('anónimo: lista los publicados en orden, con totales y sin progreso', async () => {
    const res = await get('/api/courses');
    expect(res.status).toBe(200);
    const { courses: list } = (await res.json()) as ListBody;
    expect(list.map((c) => c.slug)).toEqual([PREMIUM, FREE]);
    expect(list[0]).toMatchObject({
      moduleCount: 2,
      lessonCount: 4,
      durationSeconds: (7 + 12 + 15 + 18) * 60,
      progress: null,
    });
    expect(list[0]).not.toHaveProperty('id');
  });

  test('no lista cursos sin publicar ni con publicación futura', async () => {
    await db.insert(courses).values([
      { slug: 'borrador', title: 'Borrador', shortDescription: 'x' },
      {
        slug: 'futuro',
        title: 'Futuro',
        shortDescription: 'x',
        publishedAt: new Date(Date.now() + 86_400_000),
      },
    ]);
    const { courses: list } = (await (await get('/api/courses')).json()) as ListBody;
    expect(list.map((c) => c.slug)).not.toContain('borrador');
    expect(list.map((c) => c.slug)).not.toContain('futuro');
    expect((await get('/api/courses/borrador')).status).toBe(404);
  });

  test('logueado: trae lecciones completadas sobre el total', async () => {
    const { token } = await newUser();
    await putProgress(FREE, 'contexto-primero', { completed: true }, token);
    const { courses: list } = (await (await get('/api/courses', token)).json()) as ListBody;
    expect(list.find((c) => c.slug === FREE)?.progress).toEqual({ completed: 1, total: 2 });
    expect(list.find((c) => c.slug === PREMIUM)?.progress).toEqual({ completed: 0, total: 4 });
  });
});

describe('GET /api/courses/:slug', () => {
  test('temario público: premium solo abre la lección de preview', async () => {
    const res = await get(`/api/courses/${PREMIUM}`);
    expect(res.status).toBe(200);
    const { course } = (await res.json()) as DetailBody;
    expect(course.modules.map((m) => m.title)).toEqual(['Fundamentos', 'En producción']);
    const flat = course.modules.flatMap((m) => m.lessons);
    expect(flat.map((l) => [l.slug, l.isLocked])).toEqual([
      ['que-es-un-agente', false],
      ['planificar-antes-de-actuar', true],
      ['herramientas-y-permisos', true],
      ['evaluar-al-agente', true],
    ]);
    expect(course.progress).toBeNull();
  });

  test('curso free: todo abierto aun sin login', async () => {
    const { course } = (await (await get(`/api/courses/${FREE}`)).json()) as DetailBody;
    expect(course.modules.flatMap((m) => m.lessons).every((l) => !l.isLocked)).toBe(true);
  });

  test('suscriptor y admin: todo abierto', async () => {
    const sub = await newSubscriber();
    const admin = await newUser({ email: TEST_ADMIN_EMAIL, sub: 'google-admin-cursos' });
    for (const token of [sub.token, admin.token]) {
      const { course } = (await (await get(`/api/courses/${PREMIUM}`, token)).json()) as DetailBody;
      expect(course.modules.flatMap((m) => m.lessons).every((l) => !l.isLocked)).toBe(true);
    }
  });

  test('inexistente: 404', async () => {
    expect((await get('/api/courses/no-existe')).status).toBe(404);
  });
});

describe('GET /api/courses/:slug/lessons/:lesson', () => {
  test('bloqueada: sin video ni contenido, pero con navegación', async () => {
    const res = await get(`/api/courses/${PREMIUM}/lessons/herramientas-y-permisos`);
    expect(res.status).toBe(200);
    const { lesson } = (await res.json()) as LessonBody;
    expect(lesson.isLocked).toBe(true);
    expect(lesson).not.toHaveProperty('youtubeUrl');
    expect(lesson).not.toHaveProperty('contentMd');
    // prev/next cruzan el borde entre módulos.
    expect(lesson.prev?.slug).toBe('planificar-antes-de-actuar');
    expect(lesson.next?.slug).toBe('evaluar-al-agente');
  });

  test('preview: abierta para anónimos, sin prev en la primera', async () => {
    const { lesson } = (await (
      await get(`/api/courses/${PREMIUM}/lessons/que-es-un-agente`)
    ).json()) as LessonBody;
    expect(lesson.isLocked).toBe(false);
    expect(lesson.youtubeUrl).toContain('youtube.com');
    expect(lesson.prev).toBeNull();
    expect(lesson.progress).toBeNull();
  });

  test('suscriptor: ve el contenido; la última no tiene next', async () => {
    const { token } = await newSubscriber();
    const { lesson } = (await (
      await get(`/api/courses/${PREMIUM}/lessons/evaluar-al-agente`, token)
    ).json()) as LessonBody;
    expect(lesson.isLocked).toBe(false);
    expect(lesson.contentMd).toContain('evals');
    expect(lesson.next).toBeNull();
    expect(lesson.progress).toEqual({ secondsWatched: 0, completed: false });
  });

  test('lección de otro curso: 404', async () => {
    expect((await get(`/api/courses/${FREE}/lessons/que-es-un-agente`)).status).toBe(404);
  });
});

describe('PUT /api/courses/:slug/lessons/:lesson/progress', () => {
  test('sin auth: 401', async () => {
    expect((await putProgress(FREE, 'contexto-primero', { completed: true })).status).toBe(401);
  });

  test('premium sin suscripción: 403, preview sí', async () => {
    const { token } = await newUser();
    const locked = await putProgress(PREMIUM, 'evaluar-al-agente', { completed: true }, token);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual({ error: 'subscription_required' });
    expect((await putProgress(PREMIUM, 'que-es-un-agente', { secondsWatched: 30 }, token)).status).toBe(
      200,
    );
  });

  test('body inválido: 400', async () => {
    const { token } = await newUser();
    for (const body of [{}, { secondsWatched: -1 }, { secondsWatched: 1.5 }, { completed: 'si' }, 'no-json', []]) {
      expect((await putProgress(FREE, 'contexto-primero', body, token)).status).toBe(400);
    }
  });

  test('lección inexistente: 404', async () => {
    const { token } = await newUser();
    expect((await putProgress(FREE, 'no-existe', { completed: true }, token)).status).toBe(404);
  });

  test('los segundos nunca retroceden y completed conserva la primera fecha', async () => {
    const { token, id } = await newUser();
    const send = async (body: unknown) =>
      ((await (await putProgress(FREE, 'ejemplos-que-ensenan', body, token)).json()) as {
        progress: { secondsWatched: number; completed: boolean };
      }).progress;

    expect(await send({ secondsWatched: 120 })).toEqual({ secondsWatched: 120, completed: false });
    expect(await send({ secondsWatched: 60 })).toEqual({ secondsWatched: 120, completed: false });
    expect(await send({ completed: true })).toEqual({ secondsWatched: 120, completed: true });

    const [first] = await db.select().from(progress).where(eq(progress.userId, id));
    await send({ completed: true, secondsWatched: 200 });
    const [second] = await db.select().from(progress).where(eq(progress.userId, id));
    expect(second?.completedAt).toEqual(first?.completedAt ?? null);
    expect(second?.secondsWatched).toBe(200);

    // Mandar solo segundos no descompleta.
    expect(await send({ secondsWatched: 10 })).toEqual({ secondsWatched: 200, completed: true });
    expect(await send({ completed: false })).toEqual({ secondsWatched: 200, completed: false });
  });

  test('el temario refleja el progreso del usuario', async () => {
    const { token } = await newSubscriber();
    await putProgress(PREMIUM, 'que-es-un-agente', { completed: true }, token);
    await putProgress(PREMIUM, 'planificar-antes-de-actuar', { secondsWatched: 90 }, token);
    const { course } = (await (await get(`/api/courses/${PREMIUM}`, token)).json()) as DetailBody;
    const [first, second] = course.modules[0]?.lessons ?? [];
    expect(first?.progress).toEqual({ secondsWatched: 0, completed: true });
    expect(second?.progress).toEqual({ secondsWatched: 90, completed: false });
    expect(course.progress).toEqual({ completed: 1, total: 4 });
  });

  test('rate limit por usuario: 429', async () => {
    const limited = await createTestApp({ progress: { limit: 2, windowMs: 60_000 } });
    const token = await makeToken({ sub: 'google-rl', email: 'rl@example.com' });
    const put = () =>
      limited.app.request(`/api/courses/${FREE}/lessons/contexto-primero/progress`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ secondsWatched: 5 }),
      });
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(429);
  });
});

describe('invariantes del schema y del seed', () => {
  test('una lección no puede declarar un curso distinto al de su módulo', async () => {
    const [premium] = await db.select().from(courses).where(eq(courses.slug, PREMIUM));
    const [free] = await db.select().from(courses).where(eq(courses.slug, FREE));
    const [mod] = await db.select().from(modules).where(eq(modules.courseId, premium!.id));
    await expect(
      db.insert(lessons).values({ moduleId: mod!.id, courseId: free!.id, slug: 'trucha', title: 'x' }).execute(),
    ).rejects.toThrow();
  });

  test('re-correr el seed no duplica el temario ni borra el progreso', async () => {
    const { token, id } = await newUser();
    await putProgress(FREE, 'contexto-primero', { completed: true }, token);
    const before = await db.select().from(lessons);

    await seed(db);

    expect((await db.select().from(lessons)).length).toBe(before.length);
    expect(await db.select().from(progress).where(eq(progress.userId, id))).toHaveLength(1);
  });
});

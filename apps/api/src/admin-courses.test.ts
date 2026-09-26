import { beforeAll, describe, expect, test } from 'bun:test';
import type { createApp } from './app.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  ({ app } = await createTestApp());
  adminToken = await makeToken({ sub: 'google-admin-ac', email: 'admin@example.com' });
  userToken = await makeToken({ sub: 'google-comun-ac', email: 'comun-ac@example.com' });
});

async function req<T = unknown>(method: string, path: string, body?: unknown, token = adminToken) {
  const res = await app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

type AdminCourse = {
  id: string;
  slug: string;
  learners: number;
  modules: { id: string; title: string; lessons: { id: string; slug: string; hasVideo: boolean }[] }[];
};

const getCourse = async (id: string) =>
  (await req<{ course: AdminCourse }>('GET', `/api/admin/courses/${id}`)).body.course;

async function newCourse(slug: string, over: Record<string, unknown> = {}) {
  const res = await req<{ course: { id: string } }>('POST', '/api/admin/courses', {
    slug,
    title: `Curso ${slug}`,
    shortDescription: 'Corta',
    tier: 'premium',
    ...over,
  });
  expect(res.status).toBe(201);
  return res.body.course.id;
}

async function newModule(courseId: string, title: string) {
  const res = await req<{ module: { id: string } }>('POST', `/api/admin/courses/${courseId}/modules`, { title });
  expect(res.status).toBe(201);
  return res.body.module.id;
}

async function newLesson(moduleId: string, slug: string, over: Record<string, unknown> = {}) {
  const res = await req<{ lesson: { id: string } }>('POST', `/api/admin/modules/${moduleId}/lessons`, {
    slug,
    title: `Lección ${slug}`,
    ...over,
  });
  expect(res.status).toBe(201);
  return res.body.lesson.id;
}

describe('acceso', () => {
  test('un usuario común recibe 404 en todo el admin de cursos', async () => {
    expect((await req('GET', '/api/admin/courses', undefined, userToken)).status).toBe(404);
    expect(
      (await req('POST', '/api/admin/courses', { slug: 'x', title: 'x', shortDescription: 'x', tier: 'free' }, userToken))
        .status,
    ).toBe(404);
  });
});

describe('cursos', () => {
  test('lista incluye los del seed con conteos, y los borradores', async () => {
    await newCourse('borrador-admin');
    const { body } = await req<{ courses: { slug: string; lessonCount: number; publishedAt: string | null }[] }>(
      'GET',
      '/api/admin/courses',
    );
    const seeded = body.courses.find((c) => c.slug === 'agentes-de-punta-a-punta');
    expect(seeded?.lessonCount).toBe(4);
    expect(body.courses.find((c) => c.slug === 'borrador-admin')?.publishedAt).toBeNull();
  });

  test('validación: slug inválido, tier, URL', async () => {
    const base = { slug: 'ok', title: 'x', shortDescription: 'x', tier: 'free' };
    expect((await req('POST', '/api/admin/courses', { ...base, slug: 'Con Espacios' })).body).toEqual({
      error: 'invalid_input',
      field: 'slug',
    });
    expect((await req('POST', '/api/admin/courses', { ...base, tier: 'gold' })).status).toBe(400);
    expect((await req('POST', '/api/admin/courses', { ...base, coverImageUrl: 'javascript:alert(1)' })).body).toEqual({
      error: 'invalid_input',
      field: 'coverImageUrl',
    });
  });

  test('slug repetido: 409 al crear y al editar', async () => {
    const a = await newCourse('slug-a');
    await newCourse('slug-b');
    expect((await req('POST', '/api/admin/courses', { slug: 'slug-a', title: 'x', shortDescription: 'x', tier: 'free' })).status).toBe(409);
    expect((await req('PATCH', `/api/admin/courses/${a}`, { slug: 'slug-b' })).status).toBe(409);
    expect((await req('PATCH', `/api/admin/courses/${a}`, { slug: 'slug-a' })).status).toBe(200);
  });

  test('publicar con PATCH lo hace visible en la API pública', async () => {
    const id = await newCourse('se-publica', { tier: 'free' });
    expect((await app.request('/api/courses/se-publica')).status).toBe(404);
    await req('PATCH', `/api/admin/courses/${id}`, { publishedAt: new Date(Date.now() - 1000).toISOString() });
    expect((await app.request('/api/courses/se-publica')).status).toBe(200);
  });

  test('borrar un curso borra módulos y lecciones', async () => {
    const id = await newCourse('para-borrar');
    const mod = await newModule(id, 'M');
    const lesson = await newLesson(mod, 'l1');
    expect((await req('DELETE', `/api/admin/courses/${id}`)).status).toBe(204);
    expect((await req('GET', `/api/admin/courses/${id}`)).status).toBe(404);
    expect((await req('GET', `/api/admin/lessons/${lesson}`)).status).toBe(404);
  });

  test('id que no es uuid: 404', async () => {
    expect((await req('GET', '/api/admin/courses/nope')).status).toBe(404);
  });
});

describe('módulos y lecciones', () => {
  test('se agregan al final, en orden', async () => {
    const id = await newCourse('orden');
    const m1 = await newModule(id, 'Uno');
    await newModule(id, 'Dos');
    await newLesson(m1, 'a');
    await newLesson(m1, 'b', { youtubeUrl: 'https://youtu.be/abcdefghijk', isFreePreview: true });
    const course = await getCourse(id);
    expect(course.modules.map((m) => m.title)).toEqual(['Uno', 'Dos']);
    expect(course.modules[0]?.lessons.map((l) => [l.slug, l.hasVideo])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  test('slug de lección único por curso, pero repetible entre cursos', async () => {
    const c1 = await newCourse('slugs-1');
    const c2 = await newCourse('slugs-2');
    const m1 = await newModule(c1, 'M');
    const m1b = await newModule(c1, 'M2');
    const m2 = await newModule(c2, 'M');
    await newLesson(m1, 'intro');
    expect((await req('POST', `/api/admin/modules/${m1b}/lessons`, { slug: 'intro', title: 'x' })).status).toBe(409);
    expect((await req('POST', `/api/admin/modules/${m2}/lessons`, { slug: 'intro', title: 'x' })).status).toBe(201);
  });

  test('mover módulos y lecciones arriba/abajo; en el borde no hace nada', async () => {
    const id = await newCourse('mover');
    const m1 = await newModule(id, 'Uno');
    const m2 = await newModule(id, 'Dos');
    const m3 = await newModule(id, 'Tres');
    expect((await req('POST', `/api/admin/modules/${m3}/move`, { direction: 'up' })).status).toBe(204);
    expect((await getCourse(id)).modules.map((m) => m.title)).toEqual(['Uno', 'Tres', 'Dos']);
    await req('POST', `/api/admin/modules/${m1}/move`, { direction: 'up' });
    expect((await getCourse(id)).modules.map((m) => m.title)).toEqual(['Uno', 'Tres', 'Dos']);

    const a = await newLesson(m2, 'la');
    await newLesson(m2, 'lb');
    await req('POST', `/api/admin/lessons/${a}/move`, { direction: 'down' });
    const dos = (await getCourse(id)).modules.find((m) => m.title === 'Dos');
    expect(dos?.lessons.map((l) => l.slug)).toEqual(['lb', 'la']);

    expect((await req('POST', `/api/admin/lessons/${a}/move`, { direction: 'izquierda' })).status).toBe(400);
  });

  test('una lección se puede mover de módulo dentro del curso, no a otro curso', async () => {
    const c1 = await newCourse('mueve-1');
    const c2 = await newCourse('mueve-2');
    const m1 = await newModule(c1, 'A');
    const m2 = await newModule(c1, 'B');
    const other = await newModule(c2, 'X');
    await newLesson(m2, 'ya-estaba');
    const l = await newLesson(m1, 'viajera');

    expect((await req('PATCH', `/api/admin/lessons/${l}`, { moduleId: other })).body).toEqual({
      error: 'invalid_input',
      field: 'moduleId',
    });
    expect((await req('PATCH', `/api/admin/lessons/${l}`, { moduleId: m2 })).status).toBe(200);
    const b = (await getCourse(c1)).modules.find((m) => m.title === 'B');
    expect(b?.lessons.map((x) => x.slug)).toEqual(['ya-estaba', 'viajera']);
  });

  test('editar y borrar una lección', async () => {
    const id = await newCourse('editar-leccion');
    const m = await newModule(id, 'M');
    const l = await newLesson(m, 'vieja');
    const res = await req<{ lesson: { slug: string; contentMd: string; isFreePreview: boolean } }>(
      'PATCH',
      `/api/admin/lessons/${l}`,
      { slug: 'nueva', contentMd: 'Texto', isFreePreview: true },
    );
    expect(res.body.lesson).toMatchObject({ slug: 'nueva', contentMd: 'Texto', isFreePreview: true });
    expect((await req('PATCH', `/api/admin/lessons/${l}`, { isFreePreview: 'si' })).status).toBe(400);
    expect((await req('PATCH', `/api/admin/lessons/${l}`, {})).status).toBe(400);
    expect((await req('DELETE', `/api/admin/lessons/${l}`)).status).toBe(204);
    expect((await req('DELETE', `/api/admin/lessons/${l}`)).status).toBe(404);
  });

  test('módulo en curso inexistente: 404', async () => {
    expect(
      (await req('POST', '/api/admin/courses/00000000-0000-4000-8000-000000000000/modules', { title: 'x' })).status,
    ).toBe(404);
  });

  test('el detalle cuenta alumnos con progreso', async () => {
    const list = (await req<{ courses: { id: string; slug: string }[] }>('GET', '/api/admin/courses')).body.courses;
    const free = list.find((c) => c.slug === 'prompting-desde-cero');
    const learner = await makeToken({ sub: 'google-alumno-ac', email: 'alumno-ac@example.com' });
    await app.request('/api/courses/prompting-desde-cero/lessons/contexto-primero/progress', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${learner}`, 'content-type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    expect((await getCourse(free!.id)).learners).toBe(1);
  });
});

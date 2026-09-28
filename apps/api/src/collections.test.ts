import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { courses, lessons, progress, tools } from './db/schema.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  adminToken = await makeToken({ sub: 'google-admin-col', email: 'admin@example.com' });
  userToken = await makeToken({ sub: 'google-comun-col', email: 'comun-col@example.com' });
});

async function req<T = unknown>(method: string, path: string, body?: unknown, token: string | null = adminToken) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

const idOf = async (table: typeof tools | typeof courses, slug: string) =>
  (await db.select({ id: table.id }).from(table).where(eq(table.slug, slug)))[0]!.id;

let seq = 0;
async function newCollection(over: Record<string, unknown> = {}) {
  seq += 1;
  const res = await req<{ collection: { id: string; slug: string } }>('POST', '/api/admin/collections', {
    slug: `ruta-${seq}`,
    title: `Ruta ${seq}`,
    shortDescription: 'Para arrancar',
    publishedAt: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  });
  expect(res.status).toBe(201);
  return res.body.collection;
}

const addItem = (collectionId: string, body: unknown) => req<{ item: { id: string } }>('POST', `/api/admin/collections/${collectionId}/items`, body);

type AdminDetail = { items: { id: string; slug: string; kind: string; note: string | null }[] };
const adminDetail = async (id: string) =>
  (await req<{ collection: AdminDetail }>('GET', `/api/admin/collections/${id}`)).body.collection;

type PublicItem =
  | { kind: 'tool'; note: string | null; tool: { slug: string; isLocked: boolean } }
  | { kind: 'course'; note: string | null; course: { slug: string; lessonCount: number; progress: { completed: number; total: number } | null } };
type PublicDetail = { items: PublicItem[]; progress: { coursesCompleted: number; courses: number } | null };

describe('admin de rutas', () => {
  test('solo admins', async () => {
    expect((await req('GET', '/api/admin/collections', undefined, userToken)).status).toBe(404);
  });

  test('crea, valida el slug y no deja repetirlo', async () => {
    const col = await newCollection({ slug: 'unica' });
    expect((await req('POST', '/api/admin/collections', { slug: 'unica', title: 'x', shortDescription: 'y' })).status).toBe(409);
    expect((await req('POST', '/api/admin/collections', { slug: 'Mal Slug', title: 'x', shortDescription: 'y' })).body).toEqual({
      error: 'invalid_input',
      field: 'slug',
    });
    expect((await req('PATCH', `/api/admin/collections/${col.id}`, { title: 'Otra' })).status).toBe(200);
  });

  test('ítems: exactamente un destino, sin repetir, y se reordenan', async () => {
    const col = await newCollection();
    const tool = await idOf(tools, 'prompt-debug');
    const course = await idOf(courses, 'prompting-desde-cero');

    expect((await addItem(col.id, { toolId: tool, courseId: course })).body).toMatchObject({ field: 'target' });
    expect((await addItem(col.id, {})).body).toMatchObject({ field: 'target' });
    expect((await addItem(col.id, { toolId: '00000000-0000-0000-0000-000000000000' })).body).toMatchObject({ field: 'toolId' });

    const first = await addItem(col.id, { courseId: course, note: 'Base primero' });
    expect(first.status).toBe(201);
    const second = await addItem(col.id, { toolId: tool });
    expect(second.status).toBe(201);
    expect((await addItem(col.id, { toolId: tool })).status).toBe(409);

    expect((await adminDetail(col.id)).items.map((i) => i.slug)).toEqual(['prompting-desde-cero', 'prompt-debug']);
    expect((await req('POST', `/api/admin/collection-items/${second.body.item.id}/move`, { direction: 'up' })).status).toBe(204);
    expect((await req('PATCH', `/api/admin/collection-items/${second.body.item.id}`, { note: 'Arrancá acá' })).status).toBe(200);
    const items = (await adminDetail(col.id)).items;
    expect(items.map((i) => [i.slug, i.kind, i.note])).toEqual([
      ['prompt-debug', 'tool', 'Arrancá acá'],
      ['prompting-desde-cero', 'course', 'Base primero'],
    ]);

    expect((await req('DELETE', `/api/admin/collection-items/${first.body.item.id}`)).status).toBe(204);
    expect((await adminDetail(col.id)).items).toHaveLength(1);
  });

  test('borrar la ruta borra sus ítems', async () => {
    const col = await newCollection();
    await addItem(col.id, { toolId: await idOf(tools, 'prompt-debug') });
    expect((await req('DELETE', `/api/admin/collections/${col.id}`)).status).toBe(204);
    expect((await req('GET', `/api/admin/collections/${col.id}`)).status).toBe(404);
  });
});

describe('rutas públicas', () => {
  test('el listado solo muestra publicadas con al menos un ítem visible', async () => {
    const visible = await newCollection();
    await addItem(visible.id, { toolId: await idOf(tools, 'meta-prompt-arquitecto') });
    const draft = await newCollection({ publishedAt: null });
    await addItem(draft.id, { toolId: await idOf(tools, 'meta-prompt-arquitecto') });
    const empty = await newCollection();

    const { body } = await req<{ collections: { slug: string; toolCount: number; courseCount: number }[] }>(
      'GET',
      '/api/collections',
      undefined,
      null,
    );
    const slugs = body.collections.map((c) => c.slug);
    expect(slugs).toContain(visible.slug);
    expect(slugs).not.toContain(draft.slug);
    expect(slugs).not.toContain(empty.slug);
    expect(body.collections.find((c) => c.slug === visible.slug)).toMatchObject({ toolCount: 1, courseCount: 0 });
    expect((await req('GET', `/api/collections/${draft.slug}`, undefined, null)).status).toBe(404);
  });

  test('detalle: candado por herramienta, progreso de cursos y oculta lo no publicado', async () => {
    const col = await newCollection();
    const hidden = await idOf(tools, 'evaluar-outputs');
    await db.update(tools).set({ publishedAt: null }).where(eq(tools.id, hidden));
    const course = await idOf(courses, 'prompting-desde-cero');
    await addItem(col.id, { toolId: await idOf(tools, 'meta-prompt-arquitecto') });
    await addItem(col.id, { toolId: await idOf(tools, 'code-review-agentico'), note: 'Premium' });
    await addItem(col.id, { toolId: hidden });
    await addItem(col.id, { courseId: course });

    const anon = (await req<{ collection: PublicDetail }>('GET', `/api/collections/${col.slug}`, undefined, null)).body.collection;
    expect(anon.items.map((i) => i.kind)).toEqual(['tool', 'tool', 'course']);
    expect(anon.items.map((i) => (i.kind === 'tool' ? i.tool.isLocked : null))).toEqual([false, true, null]);
    expect(anon.progress).toBeNull();

    const me = (await (await app.request('/api/me', { headers: { Authorization: `Bearer ${userToken}` } })).json()) as {
      user: { id: string };
    };
    const courseLessons = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, course));
    await db
      .insert(progress)
      .values(courseLessons.map((l) => ({ userId: me.user.id, lessonId: l.id, secondsWatched: 60, completedAt: new Date() })));

    const logged = (await req<{ collection: PublicDetail }>('GET', `/api/collections/${col.slug}`, undefined, userToken)).body
      .collection;
    const courseItem = logged.items.find((i) => i.kind === 'course');
    expect(courseItem?.kind === 'course' && courseItem.course.progress).toEqual({
      completed: courseLessons.length,
      total: courseLessons.length,
    });
    expect(logged.progress).toEqual({ coursesCompleted: 1, courses: 1 });
  });
});

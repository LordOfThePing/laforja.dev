import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { categories, users } from './db/schema.ts';
import { TEST_ADMIN_EMAIL, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let adminToken: string;
let userToken: string;
let categoryId: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  adminToken = await makeToken({ sub: 'google-admin', email: 'Admin@Example.com' });
  userToken = await makeToken({ sub: 'google-comun', email: 'comun@example.com' });
  const [cat] = await db.select().from(categories).where(eq(categories.slug, 'prompts'));
  categoryId = cat!.id;
});

function req(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const newTool = (over: Record<string, unknown> = {}) => ({
  slug: 'herramienta-nueva',
  title: 'Herramienta nueva',
  shortDescription: 'Corta',
  promptBody: 'Hacé esto',
  tier: 'premium',
  categoryId,
  tags: ['a', 'b', 'a'],
  ...over,
});

describe('rol admin', () => {
  test('un email de ADMIN_EMAILS queda admin al loguearse (sin importar mayúsculas)', async () => {
    const res = await req('GET', '/api/me', adminToken);
    const body = (await res.json()) as { user: { role: string } };
    expect(body.user.role).toBe('admin');
  });

  test('el resto queda como user', async () => {
    const body = (await (await req('GET', '/api/me', userToken)).json()) as { user: { role: string } };
    expect(body.user.role).toBe('user');
  });

  test('el admin ve las premium sin gastar cupo', async () => {
    const res = await req('GET', '/api/tools/code-review-agentico', adminToken);
    const body = (await res.json()) as { tool: { isLocked: boolean; promptBody?: string } };
    expect(body.tool.isLocked).toBe(false);
    expect(body.tool.promptBody).toBeString();

    const unlock = await req('POST', '/api/tools/code-review-agentico/unlock', adminToken);
    expect(unlock.status).toBe(200);
  });

  test('sin admin: 404 en todo /api/admin', async () => {
    expect((await req('GET', '/api/admin/tools', userToken)).status).toBe(404);
    expect((await req('GET', '/api/admin/stats')).status).toBe(401);
  });
});

describe('ABM de herramientas', () => {
  let id: string;

  test('crea, con tags deduplicadas', async () => {
    const res = await req('POST', '/api/admin/tools', adminToken, newTool());
    expect(res.status).toBe(201);
    const { tool } = (await res.json()) as { tool: { id: string; tags: string[]; publishedAt: null } };
    expect(tool.tags).toEqual(['a', 'b']);
    expect(tool.publishedAt).toBeNull();
    id = tool.id;
  });

  test('sin publicar no aparece en el catálogo público', async () => {
    expect((await req('GET', '/api/tools/herramienta-nueva')).status).toBe(404);
  });

  test('slug repetido: 409', async () => {
    const res = await req('POST', '/api/admin/tools', adminToken, newTool());
    expect(res.status).toBe(409);
  });

  const bad: [string, Record<string, unknown>][] = [
    ['slug', { slug: 'Con Espacios' }],
    ['title', { title: '' }],
    ['tier', { tier: 'gold' }],
    ['categoryId', { categoryId: '00000000-0000-0000-0000-000000000000' }],
    ['youtubeUrl', { youtubeUrl: 'javascript:alert(1)' }],
    ['durationSeconds', { durationSeconds: -3 }],
  ];
  for (const [field, over] of bad) {
    test(`input inválido (${field}): 400`, async () => {
      const res = await req('POST', '/api/admin/tools', adminToken, newTool({ slug: 'otra', ...over }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { field: string }).field).toBe(field);
    });
  }

  test('publica con PATCH parcial y aparece en el catálogo', async () => {
    const res = await req('PATCH', `/api/admin/tools/${id}`, adminToken, {
      publishedAt: new Date(Date.now() - 1000).toISOString(),
      title: 'Título editado',
    });
    expect(res.status).toBe(200);
    const pub = await req('GET', '/api/tools/herramienta-nueva');
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { tool: { title: string } }).tool.title).toBe('Título editado');
  });

  test('borra', async () => {
    expect((await req('DELETE', `/api/admin/tools/${id}`, adminToken)).status).toBe(204);
    expect((await req('GET', `/api/admin/tools/${id}`, adminToken)).status).toBe(404);
  });
});

describe('categorías', () => {
  test('no deja borrar una categoría con herramientas', async () => {
    const res = await req('DELETE', `/api/admin/categories/${categoryId}`, adminToken);
    expect(res.status).toBe(409);
  });

  test('crea, edita y borra una vacía', async () => {
    const res = await req('POST', '/api/admin/categories', adminToken, { slug: 'nueva', name: 'Nueva' });
    expect(res.status).toBe(201);
    const { category } = (await res.json()) as { category: { id: string } };
    const edit = await req('PATCH', `/api/admin/categories/${category.id}`, adminToken, { order: 9 });
    expect(edit.status).toBe(200);
    expect((await req('DELETE', `/api/admin/categories/${category.id}`, adminToken)).status).toBe(204);
  });
});

describe('usuarios', () => {
  test('promueve a otro usuario', async () => {
    const [comun] = await db.select().from(users).where(eq(users.email, 'comun@example.com'));
    const res = await req('PATCH', `/api/admin/users/${comun!.id}`, adminToken, { role: 'admin' });
    expect(res.status).toBe(200);
    await req('PATCH', `/api/admin/users/${comun!.id}`, adminToken, { role: 'user' });
  });

  test('no se puede sacar el rol a sí mismo', async () => {
    const [admin] = await db.select().from(users).where(eq(users.email, 'Admin@Example.com'));
    expect(admin).toBeDefined();
    expect(TEST_ADMIN_EMAIL).toBe(admin!.email.toLowerCase());
    const res = await req('PATCH', `/api/admin/users/${admin!.id}`, adminToken, { role: 'user' });
    expect(res.status).toBe(409);
  });
});

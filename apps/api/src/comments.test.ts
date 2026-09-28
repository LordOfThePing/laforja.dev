import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { users } from './db/schema.ts';
import { MAX_COMMENT_LENGTH, parseCommentInput, publicAuthorName } from './lib/comments.ts';
import { TEST_ADMIN_EMAIL, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await createTestApp({ comment: { limit: 3, windowMs: 60_000 } }));
});

let userSeq = 0;
async function newUser(claims: Record<string, unknown> = {}) {
  userSeq += 1;
  const token = await makeToken({
    sub: `google-c${userSeq}`,
    email: `c${userSeq}@example.com`,
    name: 'Ana María González',
    ...claims,
  });
  const me = (await (await req('GET', '/api/me', token)).json()) as { user: { id: string } };
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

function req(method: string, path: string, token?: string, json?: unknown) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
}

type Comment = {
  id: string;
  body: string;
  author: { name: string; avatarUrl: string | null };
  isMine: boolean;
  canDelete: boolean;
};
type ListBody = { comments: Comment[]; canComment: boolean };

async function post(slug: string, token: string, body: unknown = { body: 'Me sirvió mucho.' }) {
  return req('POST', `/api/tools/${slug}/comments`, token, body);
}

describe('parseCommentInput', () => {
  test('recorta, normaliza saltos y colapsa líneas vacías', () => {
    expect(parseCommentInput({ body: '  hola\r\n\r\n\r\n\r\nchau  ' })).toBe('hola\n\nchau');
  });
  test('rechaza vacío, solo espacios, no-string y demasiado largo', () => {
    expect(parseCommentInput({ body: '' })).toBeNull();
    expect(parseCommentInput({ body: '   \n ' })).toBeNull();
    expect(parseCommentInput({ body: 42 })).toBeNull();
    expect(parseCommentInput(null)).toBeNull();
    expect(parseCommentInput({ body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) })).toBeNull();
    expect(parseCommentInput({ body: 'x'.repeat(MAX_COMMENT_LENGTH) })).not.toBeNull();
  });
});

describe('publicAuthorName', () => {
  test('primer nombre + inicial del último apellido', () => {
    expect(publicAuthorName('Ana María González')).toBe('Ana G.');
    expect(publicAuthorName('pedro flynn')).toBe('pedro F.');
  });
  test('un solo nombre o nada', () => {
    expect(publicAuthorName('Ana')).toBe('Ana');
    expect(publicAuthorName(null)).toBe('Suscriptor');
    expect(publicAuthorName('   ')).toBe('Suscriptor');
  });
});

describe('GET /api/tools/:slug/comments', () => {
  test('herramienta free sin login: 200, lista vacía y no puede comentar', async () => {
    const res = await req('GET', '/api/tools/meta-prompt-arquitecto/comments');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [], canComment: false });
  });

  test('premium sin desbloquear: 403 locked', async () => {
    const { token } = await newUser();
    const res = await req('GET', '/api/tools/prompt-debug/comments', token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'locked' });
  });

  test('premium desbloqueada con el cupo: lee pero no puede comentar', async () => {
    const { token } = await newUser();
    expect((await req('POST', '/api/tools/prompt-debug/unlock', token)).status).toBe(201);
    const res = await req('GET', '/api/tools/prompt-debug/comments', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListBody).canComment).toBe(false);
  });

  test('slug inexistente: 404', async () => {
    expect((await req('GET', '/api/tools/no-existe/comments')).status).toBe(404);
  });
});

describe('POST /api/tools/:slug/comments', () => {
  test('sin auth: 401', async () => {
    const res = await req('POST', '/api/tools/meta-prompt-arquitecto/comments', undefined, { body: 'hola' });
    expect(res.status).toBe(401);
  });

  test('sin suscripción: 403, aunque la herramienta sea free', async () => {
    const { token } = await newUser();
    const res = await post('meta-prompt-arquitecto', token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'subscription_required' });
  });

  test('suscriptor: 201 y aparece en la lista, sin email y con el nombre recortado', async () => {
    const { token } = await newSubscriber();
    const res = await post('agente-investigador', token, { body: '  Lo usé en un proyecto real.  ' });
    expect(res.status).toBe(201);
    const { comment } = (await res.json()) as { comment: Comment };
    expect(comment).toMatchObject({ body: 'Lo usé en un proyecto real.', isMine: true, canDelete: true });
    expect(comment.author.name).toBe('Ana G.');

    const other = await newUser();
    const list = (await (await req('GET', '/api/tools/agente-investigador/comments', other.token)).json()) as ListBody;
    const seen = list.comments.find((c) => c.id === comment.id);
    expect(seen).toMatchObject({ isMine: false, canDelete: false });
    expect(JSON.stringify(list)).not.toContain('@example.com');
  });

  test('body inválido: 400', async () => {
    const { token } = await newSubscriber();
    expect((await post('agente-investigador', token, { body: '   ' })).status).toBe(400);
    expect((await post('agente-investigador', token, { texto: 'hola' })).status).toBe(400);
  });

  test('slug inexistente: 404', async () => {
    const { token } = await newSubscriber();
    expect((await post('no-existe', token)).status).toBe(404);
  });

  test('rate limit por usuario: 429 al pasarse', async () => {
    const { token } = await newSubscriber();
    for (let i = 0; i < 3; i++) expect((await post('agente-investigador', token)).status).toBe(201);
    expect((await post('agente-investigador', token)).status).toBe(429);
  });
});

describe('DELETE /api/tools/:slug/comments/:id', () => {
  async function createComment() {
    const author = await newSubscriber();
    const res = await post('workflow-triage-tickets', author.token);
    const { comment } = (await res.json()) as { comment: Comment };
    return { author, id: comment.id };
  }

  test('el autor lo borra: 204 y desaparece', async () => {
    const { author, id } = await createComment();
    expect((await req('DELETE', `/api/tools/workflow-triage-tickets/comments/${id}`, author.token)).status).toBe(204);
    const list = (await (await req('GET', '/api/tools/workflow-triage-tickets/comments', author.token)).json()) as ListBody;
    expect(list.comments.some((c) => c.id === id)).toBe(false);
  });

  test('otro usuario: 404 y el comentario queda', async () => {
    const { author, id } = await createComment();
    const other = await newSubscriber();
    expect((await req('DELETE', `/api/tools/workflow-triage-tickets/comments/${id}`, other.token)).status).toBe(404);
    const list = (await (await req('GET', '/api/tools/workflow-triage-tickets/comments', author.token)).json()) as ListBody;
    expect(list.comments.some((c) => c.id === id)).toBe(true);
  });

  test('con el slug de otra herramienta: 404', async () => {
    const { author, id } = await createComment();
    expect((await req('DELETE', `/api/tools/prompt-debug/comments/${id}`, author.token)).status).toBe(404);
  });

  test('id que no es uuid: 404', async () => {
    const { author } = await createComment();
    expect((await req('DELETE', '/api/tools/workflow-triage-tickets/comments/abc', author.token)).status).toBe(404);
  });

  test('admin borra uno ajeno: 204, y ve canDelete en todos', async () => {
    const { id } = await createComment();
    const admin = await makeToken({ sub: 'google-admin-c', email: TEST_ADMIN_EMAIL, name: 'Admin' });
    const list = (await (await req('GET', '/api/tools/workflow-triage-tickets/comments', admin)).json()) as ListBody;
    expect(list.comments.every((c) => c.canDelete)).toBe(true);
    expect((await req('DELETE', `/api/tools/workflow-triage-tickets/comments/${id}`, admin)).status).toBe(204);
  });
});

describe('/api/admin/comments', () => {
  test('lista con email del autor y la herramienta; borra', async () => {
    const author = await newSubscriber();
    const { comment } = (await (await post('evaluar-outputs', author.token)).json()) as { comment: Comment };
    const admin = await makeToken({ sub: 'google-admin-c', email: TEST_ADMIN_EMAIL, name: 'Admin' });

    const res = await req('GET', '/api/admin/comments', admin);
    expect(res.status).toBe(200);
    const { comments } = (await res.json()) as {
      comments: { id: string; tool: { slug: string }; author: { email: string } }[];
    };
    const row = comments.find((c) => c.id === comment.id);
    expect(row?.tool.slug).toBe('evaluar-outputs');
    expect(row?.author.email).toMatch(/@example\.com$/);

    expect((await req('DELETE', `/api/admin/comments/${comment.id}`, admin)).status).toBe(204);
    expect((await req('DELETE', `/api/admin/comments/${comment.id}`, admin)).status).toBe(404);
  });

  test('no admin: 404', async () => {
    const { token } = await newSubscriber();
    expect((await req('GET', '/api/admin/comments', token)).status).toBe(404);
  });
});

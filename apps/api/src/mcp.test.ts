import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { categories } from './db/schema.ts';
import { TEST_MCP_TOKEN, createTestApp } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let categoryId: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp(undefined, undefined, null, { mcpAdminToken: TEST_MCP_TOKEN }));
  const [cat] = await db.select().from(categories).where(eq(categories.slug, 'prompts'));
  categoryId = cat!.id;
});

type JsonRpcResult = { jsonrpc: '2.0'; id: number | string | null; result?: any; error?: any };

async function rpc(
  method: string,
  params?: unknown,
  id: number | null = 1,
  token: string | null = TEST_MCP_TOKEN,
): Promise<{ status: number; body: JsonRpcResult | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as JsonRpcResult) : null };
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return rpc('tools/call', { name, arguments: args });
}

describe('MCP HTTP', () => {
  test('sin token: 401', async () => {
    const res = await rpc('initialize', {}, 1, null);
    expect(res.status).toBe(401);
  });

  test('token inválido: 401', async () => {
    const res = await rpc('initialize', {}, 1, 'otro');
    expect(res.status).toBe(401);
  });

  test('initialize devuelve capabilities y protocolVersion', async () => {
    const res = await rpc('initialize');
    expect(res.status).toBe(200);
    expect(res.body?.result).toMatchObject({
      protocolVersion: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      capabilities: { tools: {} },
      serverInfo: { name: 'laforja-mcp' },
    });
  });

  test('notification (sin id): 204 sin cuerpo', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TEST_MCP_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.status).toBe(204);
  });

  test('tools/list expone las tools esperadas con inputSchema', async () => {
    const res = await rpc('tools/list');
    const names = (res.body?.result.tools as Array<{ name: string; inputSchema: unknown }>).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_tools',
        'get_tool',
        'create_tool',
        'update_tool',
        'delete_tool',
        'publish_tool',
        'unpublish_tool',
        'list_categories',
        'create_category',
        'update_category',
        'delete_category',
      ]),
    );
    const createTool = (res.body?.result.tools as Array<{ name: string; inputSchema: any }>).find(
      (t) => t.name === 'create_tool',
    );
    expect(createTool?.inputSchema.required).toEqual(
      expect.arrayContaining(['slug', 'title', 'shortDescription', 'promptBody', 'tier', 'categoryId']),
    );
  });

  test('tool desconocida: content isError', async () => {
    const res = await callTool('no_existe');
    expect(res.body?.error).toMatchObject({ code: -32601 });
  });

  test('list_tools trae al menos el seed', async () => {
    const res = await callTool('list_tools');
    const data = res.body?.result.structuredContent as { tools: Array<{ slug: string }> };
    expect(data.tools.length).toBeGreaterThan(0);
    expect(data.tools.every((t) => typeof t.slug === 'string')).toBe(true);
  });

  test('create_tool, get_tool, update_tool, publish/unpublish, delete_tool', async () => {
    const create = await callTool('create_tool', {
      slug: 'herramienta-mcp',
      title: 'Herramienta MCP',
      shortDescription: 'creada por MCP',
      promptBody: 'hacé esto',
      tier: 'premium',
      categoryId,
      tags: ['mcp', 'test'],
    });
    const created = create.body?.result.structuredContent as { tool: { id: string; publishedAt: null } };
    expect(created.tool.id).toBeString();
    expect(created.tool.publishedAt).toBeNull();

    const get = await callTool('get_tool', { id: created.tool.id });
    const gotten = get.body?.result.structuredContent as { tool: { slug: string } };
    expect(gotten.tool.slug).toBe('herramienta-mcp');

    const patch = await callTool('update_tool', { id: created.tool.id, title: 'Herramienta MCP v2' });
    const patched = patch.body?.result.structuredContent as { tool: { title: string } };
    expect(patched.tool.title).toBe('Herramienta MCP v2');

    const pub = await callTool('publish_tool', { id: created.tool.id });
    const published = pub.body?.result.structuredContent as { tool: { publishedAt: string } };
    expect(published.tool.publishedAt).toBeString();

    const unpub = await callTool('unpublish_tool', { id: created.tool.id });
    const unpublished = unpub.body?.result.structuredContent as { tool: { publishedAt: null } };
    expect(unpublished.tool.publishedAt).toBeNull();

    const del = await callTool('delete_tool', { id: created.tool.id });
    expect((del.body?.result.structuredContent as { deleted: string }).deleted).toBe(created.tool.id);

    const missing = await callTool('get_tool', { id: created.tool.id });
    expect(missing.body?.result.isError).toBe(true);
  });

  test('create_tool con slug repetido: isError slug_taken', async () => {
    const first = await callTool('create_tool', {
      slug: 'dup-mcp',
      title: 't',
      shortDescription: 'd',
      promptBody: 'p',
      tier: 'premium',
      categoryId,
    });
    expect(first.body?.result.isError).toBeFalsy();

    const dup = await callTool('create_tool', {
      slug: 'dup-mcp',
      title: 't',
      shortDescription: 'd',
      promptBody: 'p',
      tier: 'premium',
      categoryId,
    });
    expect(dup.body?.result.isError).toBe(true);
    expect((dup.body?.result.content as Array<{ text: string }>)[0]!.text).toBe('slug_taken');
  });

  test('create_tool con categoryId inexistente: isError', async () => {
    const res = await callTool('create_tool', {
      slug: 'sin-cat',
      title: 't',
      shortDescription: 'd',
      promptBody: 'p',
      tier: 'premium',
      categoryId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.body?.result.isError).toBe(true);
  });

  test('update_tool con id inválido: isError invalid_id', async () => {
    const res = await callTool('update_tool', { id: 'no-uuid', title: 'x' });
    expect(res.body?.result.isError).toBe(true);
    expect((res.body?.result.content as Array<{ text: string }>)[0]!.text).toBe('invalid_id');
  });

  test('list_categories devuelve al menos las del seed', async () => {
    const res = await callTool('list_categories');
    const data = res.body?.result.structuredContent as { categories: Array<{ slug: string }> };
    expect(data.categories.length).toBeGreaterThan(0);
  });

  test('ABM de categorías + delete de una en uso falla', async () => {
    const create = await callTool('create_category', {
      slug: 'mcp-nueva',
      name: 'MCP Nueva',
      order: 99,
    });
    const created = create.body?.result.structuredContent as { category: { id: string } };
    expect(created.category.id).toBeString();

    const patch = await callTool('update_category', { id: created.category.id, name: 'MCP Renombrada' });
    expect((patch.body?.result.structuredContent as { category: { name: string } }).category.name).toBe(
      'MCP Renombrada',
    );

    const del = await callTool('delete_category', { id: created.category.id });
    expect((del.body?.result.structuredContent as { deleted: string }).deleted).toBe(created.category.id);

    // La categoría del seed tiene herramientas → delete falla con category_in_use.
    const inUse = await callTool('delete_category', { id: categoryId });
    expect(inUse.body?.result.isError).toBe(true);
    expect((inUse.body?.result.content as Array<{ text: string }>)[0]!.text).toBe('category_in_use');
  });

  test('batch: dos requests devuelven dos respuestas en orden', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${TEST_MCP_TOKEN}` },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { jsonrpc: '2.0', id: 2, method: 'initialize' },
      ]),
    });
    const body = (await res.json()) as JsonRpcResult[];
    expect(body).toHaveLength(2);
    expect(body[0]!.id).toBe(1);
    expect(body[1]!.id).toBe(2);
  });

  test('GET /mcp: 405', async () => {
    const res = await app.request('/mcp', {
      method: 'GET',
      headers: { Authorization: `Bearer ${TEST_MCP_TOKEN}` },
    });
    expect(res.status).toBe(405);
  });
});

describe('MCP apagado (sin token)', () => {
  test('sin MCP_ADMIN_TOKEN el server no monta /mcp', async () => {
    const { app: sinMcp } = await createTestApp();
    const res = await sinMcp.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(404);
  });
});

import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { categories, tools } from '../db/schema.ts';
import { isUuid, parseCategory, parseTool } from '../lib/admin-input.ts';

// Server MCP mínimo por HTTP para hacer ABM de herramientas/categorías desde un cliente
// (Claude Code, otros). Habla JSON-RPC 2.0 sobre POST, sin SSE ni sesiones — con eso alcanza
// para las tools de este dominio, que son request/response puras.
//
// Protocolo: https://modelcontextprotocol.io/specification/2025-06-18
// Registro en Claude Code:
//   claude mcp add --transport http laforja http://localhost:4000/mcp \
//     --header "Authorization: Bearer $MCP_ADMIN_TOKEN"

const PROTOCOL_VERSION = '2025-06-18';

const toolColumns = {
  id: tools.id,
  slug: tools.slug,
  title: tools.title,
  shortDescription: tools.shortDescription,
  longDescription: tools.longDescription,
  youtubeUrl: tools.youtubeUrl,
  promptBody: tools.promptBody,
  tier: tools.tier,
  categoryId: tools.categoryId,
  tags: tools.tags,
  durationSeconds: tools.durationSeconds,
  coverImageUrl: tools.coverImageUrl,
  publishedAt: tools.publishedAt,
  createdAt: tools.createdAt,
};

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type JsonRpcError = { code: number; message: string; data?: unknown };

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: JsonRpcError };

// Códigos JSON-RPC 2.0 estándar más los que usa MCP.
const ERRORS = {
  parse: { code: -32700, message: 'Parse error' },
  invalidRequest: { code: -32600, message: 'Invalid Request' },
  methodNotFound: { code: -32601, message: 'Method not found' },
  invalidParams: { code: -32602, message: 'Invalid params' },
  internal: { code: -32603, message: 'Internal error' },
} as const;

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (db: Db, args: Record<string, unknown>) => Promise<unknown>;
};

async function slugTaken(
  db: Db,
  table: typeof tools | typeof categories,
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(exceptId ? and(eq(table.slug, slug), ne(table.id, exceptId)) : eq(table.slug, slug))
    .limit(1);
  return row !== undefined;
}

async function categoryExists(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id));
  return row !== undefined;
}

class ToolError extends Error {
  constructor(readonly kind: string, message?: string) {
    super(message ?? kind);
  }
}

const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_tools',
    description: 'Lista todas las herramientas del catálogo (publicadas y no publicadas) con su categoría.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (db) => {
      const rows = await db
        .select({ ...toolColumns, categoryName: categories.name, categorySlug: categories.slug })
        .from(tools)
        .innerJoin(categories, eq(tools.categoryId, categories.id))
        .orderBy(desc(tools.createdAt), tools.slug);
      return { tools: rows };
    },
  },
  {
    name: 'get_tool',
    description: 'Devuelve una herramienta por id (UUID).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'UUID de la herramienta' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const id = args.id;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const [row] = await db.select(toolColumns).from(tools).where(eq(tools.id, id));
      if (!row) throw new ToolError('not_found');
      return { tool: row };
    },
  },
  {
    name: 'create_tool',
    description:
      'Crea una herramienta. `longDescription` es el cuerpo educativo (markdown: headings, listas y fenced code blocks). `promptBody` es opcional y sirve solo cuando la herramienta trae un prompt para copiar al agente. Campos: slug, title, shortDescription, tier ("free"|"premium"), categoryId (UUID), tags (string[]), longDescription?, promptBody?, youtubeUrl?, durationSeconds?, coverImageUrl?, publishedAt? (ISO).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        title: { type: 'string' },
        shortDescription: { type: 'string' },
        promptBody: { type: ['string', 'null'] },
        tier: { type: 'string', enum: ['free', 'premium'] },
        categoryId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        longDescription: { type: ['string', 'null'] },
        youtubeUrl: { type: ['string', 'null'] },
        durationSeconds: { type: ['integer', 'null'], minimum: 0 },
        coverImageUrl: { type: ['string', 'null'] },
        publishedAt: { type: ['string', 'null'], description: 'ISO 8601. null o ausente = borrador.' },
      },
      required: ['slug', 'title', 'shortDescription', 'tier', 'categoryId'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const parsed = parseTool(args);
      if (!parsed.ok) throw new ToolError('invalid_input', `field: ${parsed.field}`);
      const input = parsed.value;
      if (!(await categoryExists(db, input.categoryId))) {
        throw new ToolError('invalid_input', 'field: categoryId (no existe)');
      }
      if (await slugTaken(db, tools, input.slug)) throw new ToolError('slug_taken');
      const [row] = await db.insert(tools).values(input).returning(toolColumns);
      return { tool: row };
    },
  },
  {
    name: 'update_tool',
    description:
      'Actualiza una herramienta por id. Mandar sólo los campos que cambian. `publishedAt: null` la deja como borrador; una fecha ISO la publica.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        title: { type: 'string' },
        shortDescription: { type: 'string' },
        promptBody: { type: ['string', 'null'] },
        tier: { type: 'string', enum: ['free', 'premium'] },
        categoryId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        longDescription: { type: ['string', 'null'] },
        youtubeUrl: { type: ['string', 'null'] },
        durationSeconds: { type: ['integer', 'null'], minimum: 0 },
        coverImageUrl: { type: ['string', 'null'] },
        publishedAt: { type: ['string', 'null'] },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const { id, ...rest } = args;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const parsed = parseTool(rest, true);
      if (!parsed.ok) throw new ToolError('invalid_input', `field: ${parsed.field}`);
      const input = parsed.value;
      if (Object.keys(input).length === 0) throw new ToolError('invalid_input', 'field: body');
      if (input.categoryId && !(await categoryExists(db, input.categoryId))) {
        throw new ToolError('invalid_input', 'field: categoryId (no existe)');
      }
      if (input.slug && (await slugTaken(db, tools, input.slug, id))) throw new ToolError('slug_taken');
      const [row] = await db.update(tools).set(input).where(eq(tools.id, id)).returning(toolColumns);
      if (!row) throw new ToolError('not_found');
      return { tool: row };
    },
  },
  {
    name: 'delete_tool',
    description: 'Elimina una herramienta por id. Cascade borra unlocks y comentarios asociados.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const id = args.id;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const [row] = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
      if (!row) throw new ToolError('not_found');
      return { deleted: row.id };
    },
  },
  {
    name: 'publish_tool',
    description: 'Marca una herramienta como publicada ahora (publishedAt = now()).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const id = args.id;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const [row] = await db
        .update(tools)
        .set({ publishedAt: new Date() })
        .where(eq(tools.id, id))
        .returning(toolColumns);
      if (!row) throw new ToolError('not_found');
      return { tool: row };
    },
  },
  {
    name: 'unpublish_tool',
    description: 'Deja una herramienta como borrador (publishedAt = null). No la elimina.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const id = args.id;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const [row] = await db
        .update(tools)
        .set({ publishedAt: null })
        .where(eq(tools.id, id))
        .returning(toolColumns);
      if (!row) throw new ToolError('not_found');
      return { tool: row };
    },
  },
  {
    name: 'list_categories',
    description: 'Lista las categorías ordenadas por `order`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (db) => {
      const rows = await db.select().from(categories).orderBy(asc(categories.order), categories.name);
      return { categories: rows };
    },
  },
  {
    name: 'create_category',
    description: 'Crea una categoría. Campos: slug, name, description?, order?.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        order: { type: 'integer', minimum: 0 },
      },
      required: ['slug', 'name'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const parsed = parseCategory(args);
      if (!parsed.ok) throw new ToolError('invalid_input', `field: ${parsed.field}`);
      if (await slugTaken(db, categories, parsed.value.slug)) throw new ToolError('slug_taken');
      const [row] = await db.insert(categories).values(parsed.value).returning();
      return { category: row };
    },
  },
  {
    name: 'update_category',
    description: 'Actualiza una categoría por id. Mandar sólo los campos que cambian.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        order: { type: 'integer', minimum: 0 },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const { id, ...rest } = args;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const parsed = parseCategory(rest, true);
      if (!parsed.ok) throw new ToolError('invalid_input', `field: ${parsed.field}`);
      const input = parsed.value;
      if (Object.keys(input).length === 0) throw new ToolError('invalid_input', 'field: body');
      if (input.slug && (await slugTaken(db, categories, input.slug, id))) {
        throw new ToolError('slug_taken');
      }
      const [row] = await db.update(categories).set(input).where(eq(categories.id, id)).returning();
      if (!row) throw new ToolError('not_found');
      return { category: row };
    },
  },
  {
    name: 'delete_category',
    description: 'Elimina una categoría por id. Falla con `category_in_use` si hay herramientas apuntando a ella.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (db, args) => {
      const id = args.id;
      if (typeof id !== 'string' || !isUuid(id)) throw new ToolError('invalid_id');
      const [inUse] = await db.select({ id: tools.id }).from(tools).where(eq(tools.categoryId, id)).limit(1);
      if (inUse) throw new ToolError('category_in_use');
      const [row] = await db
        .delete(categories)
        .where(eq(categories.id, id))
        .returning({ id: categories.id });
      if (!row) throw new ToolError('not_found');
      return { deleted: row.id };
    },
  },
];

const TOOL_INDEX = new Map(MCP_TOOLS.map((t) => [t.name, t]));

function success(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: string | number | null, error: JsonRpcError): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error };
}

async function handleRpc(db: Db, req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  // Las notifications no llevan `id` y no deben tener respuesta.
  const isNotification = req.id === undefined;

  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    if (isNotification) return null;
    return failure(id, ERRORS.invalidRequest);
  }

  if (req.method === 'initialize') {
    return success(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'laforja-mcp', version: '0.1.0' },
    });
  }

  // El cliente manda notifications/initialized después del handshake; se acepta silenciosamente.
  if (req.method.startsWith('notifications/')) return null;

  if (req.method === 'tools/list') {
    return success(id, {
      tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (req.method === 'tools/call') {
    const params = req.params as { name?: unknown; arguments?: unknown } | undefined;
    if (!params || typeof params.name !== 'string') {
      return failure(id, { ...ERRORS.invalidParams, message: 'Falta `name`' });
    }
    const tool = TOOL_INDEX.get(params.name);
    if (!tool) {
      return failure(id, { ...ERRORS.methodNotFound, message: `Tool desconocida: ${params.name}` });
    }
    const args =
      params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    try {
      const data = await tool.handler(db, args);
      // MCP espera `content: [{type: "text", text}]`; los datos crudos van en `structuredContent`.
      return success(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      });
    } catch (err) {
      if (err instanceof ToolError) {
        // Errores del dominio se devuelven como resultado con `isError: true`, no como error de RPC:
        // así el modelo cliente los ve y puede reaccionar en vez de fallar la sesión.
        return success(id, {
          content: [{ type: 'text', text: err.message }],
          isError: true,
        });
      }
      console.error('mcp: tool crasheó', params.name, err);
      return failure(id, ERRORS.internal);
    }
  }

  if (isNotification) return null;
  return failure(id, ERRORS.methodNotFound);
}

function unauthorized(c: Context) {
  return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401);
}

export function mcpRoutes(db: Db, adminToken: string) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const header = c.req.header('Authorization');
    const token = header?.match(/^Bearer (.+)$/)?.[1];
    if (!token || token !== adminToken) return unauthorized(c);
    await next();
  });

  app.post('/', async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: ERRORS.parse }, 400);
    }

    // Batch: array de requests → array de responses (filtrando notifications).
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        return c.json({ jsonrpc: '2.0', id: null, error: ERRORS.invalidRequest }, 400);
      }
      const responses: JsonRpcResponse[] = [];
      for (const item of payload) {
        const res = await handleRpc(db, item as JsonRpcRequest);
        if (res) responses.push(res);
      }
      if (responses.length === 0) return c.body(null, 204);
      return c.json(responses);
    }

    const res = await handleRpc(db, payload as JsonRpcRequest);
    if (!res) return c.body(null, 204);
    return c.json(res);
  });

  // GET se usa en Streamable HTTP para el stream server → cliente (notifications). No lo usamos.
  app.get('/', (c) => c.body(null, 405, { Allow: 'POST' }));

  return app;
}

import type { categories, tools } from '../db/schema.ts';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; field: string };

type ToolInput = Omit<typeof tools.$inferInsert, 'id' | 'createdAt'>;
type CategoryInput = Omit<typeof categories.$inferInsert, 'id'>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FieldError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

function text(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== 'string' || !v.trim()) throw new FieldError(field);
  return v.trim();
}

function optionalText(body: Record<string, unknown>, field: string): string | null {
  const v = body[field];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new FieldError(field);
  return v.trim() || null;
}

function optionalUrl(body: Record<string, unknown>, field: string): string | null {
  const v = optionalText(body, field);
  if (v === null) return null;
  if (!URL.canParse(v) || !/^https?:$/.test(new URL(v).protocol)) throw new FieldError(field);
  return v;
}

function optionalInt(body: Record<string, unknown>, field: string): number | null {
  const v = body[field];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new FieldError(field);
  return v;
}

function optionalDate(body: Record<string, unknown>, field: string): Date | null {
  const v = body[field];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new FieldError(field);
  return new Date(v);
}

function slug(body: Record<string, unknown>): string {
  const v = text(body, 'slug');
  if (!SLUG.test(v)) throw new FieldError('slug');
  return v;
}

// PATCH manda solo los campos que cambian; POST los manda todos. Por eso se valida
// campo por campo y en modo parcial se saltean los ausentes.
function parse<T>(
  raw: unknown,
  partial: boolean,
  fields: Record<string, (body: Record<string, unknown>) => unknown>,
): ParseResult<T> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, field: 'body' };
  const body = raw as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  try {
    for (const [field, read] of Object.entries(fields)) {
      if (partial && !(field in body)) continue;
      value[field] = read(body);
    }
  } catch (err) {
    if (err instanceof FieldError) return { ok: false, field: err.field };
    throw err;
  }
  return { ok: true, value: value as T };
}

const toolFields = {
  slug,
  title: (b: Record<string, unknown>) => text(b, 'title'),
  shortDescription: (b: Record<string, unknown>) => text(b, 'shortDescription'),
  longDescription: (b: Record<string, unknown>) => optionalText(b, 'longDescription'),
  youtubeUrl: (b: Record<string, unknown>) => optionalUrl(b, 'youtubeUrl'),
  promptBody: (b: Record<string, unknown>) => text(b, 'promptBody'),
  tier: (b: Record<string, unknown>) => {
    if (b.tier !== 'free' && b.tier !== 'premium') throw new FieldError('tier');
    return b.tier;
  },
  categoryId: (b: Record<string, unknown>) => {
    const v = text(b, 'categoryId');
    if (!UUID.test(v)) throw new FieldError('categoryId');
    return v;
  },
  tags: (b: Record<string, unknown>) => {
    const v = b.tags ?? [];
    if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) throw new FieldError('tags');
    return [...new Set(v.map((t: string) => t.trim()).filter(Boolean))];
  },
  durationSeconds: (b: Record<string, unknown>) => optionalInt(b, 'durationSeconds'),
  coverImageUrl: (b: Record<string, unknown>) => optionalUrl(b, 'coverImageUrl'),
  publishedAt: (b: Record<string, unknown>) => optionalDate(b, 'publishedAt'),
};

const categoryFields = {
  slug,
  name: (b: Record<string, unknown>) => text(b, 'name'),
  description: (b: Record<string, unknown>) => optionalText(b, 'description'),
  order: (b: Record<string, unknown>) => optionalInt(b, 'order') ?? 0,
};

export function parseTool(raw: unknown): ParseResult<ToolInput>;
export function parseTool(raw: unknown, partial: true): ParseResult<Partial<ToolInput>>;
export function parseTool(raw: unknown, partial = false) {
  return parse(raw, partial, toolFields);
}

export function parseCategory(raw: unknown): ParseResult<CategoryInput>;
export function parseCategory(raw: unknown, partial: true): ParseResult<Partial<CategoryInput>>;
export function parseCategory(raw: unknown, partial = false) {
  return parse(raw, partial, categoryFields);
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

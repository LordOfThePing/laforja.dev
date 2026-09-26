import type { Session } from '@auth/core/types';
import type { AstroGlobal } from 'astro';
import { getSession } from 'auth-astro/server';
import { ApiError, type Me, call, getMe } from './api';
import { loginUrl } from './redirect';

export type AdminTool = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  longDescription: string | null;
  youtubeUrl: string | null;
  promptBody: string;
  tier: 'free' | 'premium';
  categoryId: string;
  tags: string[];
  durationSeconds: number | null;
  coverImageUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  order: number;
  toolCount: number;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  subscriptionStatus: string;
  hasAccess: boolean;
  createdAt: string;
};

export type AdminStats = {
  users: number;
  activeSubscribers: number;
  unlocksThisMonth: number;
  tools: { total: number; published: number };
};

type User = Session['user'];

// Quien no es admin recibe un 404 igual que la API: el panel no se anuncia.
export async function requireAdmin(
  Astro: AstroGlobal,
): Promise<{ ok: true; user: User; me: Me } | { ok: false; response: Response }> {
  const session = await getSession(Astro.request);
  const user = session?.user;
  if (!user) return { ok: false, response: Astro.redirect(loginUrl(Astro.url.pathname)) };
  const me = await getMe(user);
  if (me?.user.role !== 'admin') {
    return { ok: false, response: new Response('No encontrado', { status: 404 }) };
  }
  return { ok: true, user, me };
}

export const getStats = (user: User) => call<AdminStats>('/api/admin/stats', user);

export const listAdminTools = (user: User) =>
  call<{ tools: (AdminTool & { categoryName: string })[] }>('/api/admin/tools', user).then((r) => r.tools);

export async function getAdminTool(user: User, id: string): Promise<AdminTool | null> {
  try {
    return (await call<{ tool: AdminTool }>(`/api/admin/tools/${encodeURIComponent(id)}`, user)).tool;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export const listCategories = (user: User) =>
  call<{ categories: AdminCategory[] }>('/api/admin/categories', user).then((r) => r.categories);

export const listUsers = (user: User) =>
  call<{ users: AdminUser[] }>('/api/admin/users', user).then((r) => r.users);

export type MutationResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string; field?: string };

// Los errores esperables (validación, slug repetido, en uso) vuelven como valor para
// mostrarlos en el form; el resto sigue siendo excepción.
export async function mutate<T>(
  user: User,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  json?: unknown,
): Promise<MutationResult<T>> {
  try {
    return { ok: true, value: await call<T>(path, user, { method, json }) };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      const field = (err.body as { field?: string } | null)?.field;
      return { ok: false, error: err.code, field };
    }
    throw err;
  }
}

function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function optionalInt(form: FormData, name: string): number | null {
  const v = str(form, name);
  return v === '' ? null : Number(v);
}

export function toolFromForm(form: FormData, current: AdminTool | null) {
  const minutes = optionalInt(form, 'durationMinutes');
  const publish = form.get('published') === 'on';
  return {
    slug: str(form, 'slug'),
    title: str(form, 'title'),
    shortDescription: str(form, 'shortDescription'),
    longDescription: str(form, 'longDescription') || null,
    youtubeUrl: str(form, 'youtubeUrl') || null,
    promptBody: str(form, 'promptBody'),
    tier: str(form, 'tier'),
    categoryId: str(form, 'categoryId'),
    tags: str(form, 'tags')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    durationSeconds: minutes === null ? null : Math.round(minutes * 60),
    coverImageUrl: str(form, 'coverImageUrl') || null,
    // Al republicar se conserva la fecha original para no reordenar el catálogo.
    publishedAt: publish ? (current?.publishedAt ?? new Date().toISOString()) : null,
  };
}

export function categoryFromForm(form: FormData) {
  return {
    slug: str(form, 'slug'),
    name: str(form, 'name'),
    description: str(form, 'description') || null,
    order: optionalInt(form, 'order') ?? 0,
  };
}

const fieldLabels: Record<string, string> = {
  slug: 'el slug (solo minúsculas, números y guiones)',
  title: 'el título',
  name: 'el nombre',
  shortDescription: 'la descripción corta',
  promptBody: 'el prompt',
  tier: 'el tier',
  categoryId: 'la categoría',
  youtubeUrl: 'la URL de YouTube',
  coverImageUrl: 'la URL de la portada',
  durationSeconds: 'la duración',
  order: 'el orden',
  tags: 'los tags',
};

export function errorMessage(result: { error: string; field?: string }): string {
  if (result.error === 'invalid_input' && result.field) {
    return `Revisá ${fieldLabels[result.field] ?? result.field}.`;
  }
  const messages: Record<string, string> = {
    slug_taken: 'Ya existe otra con ese slug.',
    category_in_use: 'La categoría tiene herramientas: movelas o borralas antes.',
    cannot_demote_self: 'No podés sacarte el rol de admin a vos mismo.',
    not_found: 'Ya no existe.',
  };
  return messages[result.error] ?? 'Algo salió mal. Probá de nuevo.';
}

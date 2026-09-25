import type { Session } from '@auth/core/types';
import { signApiToken } from './api-token';
import { serverEnv } from './env';

export type ToolPreview = {
  slug: string;
  title: string;
  shortDescription: string;
  tier: 'free' | 'premium';
  tags: string[];
  durationSeconds: number | null;
  coverImageUrl: string | null;
  publishedAt: string;
  category: { slug: string; name: string };
  isLocked: boolean;
};

export type ToolDetail =
  | (ToolPreview & { isLocked: true })
  | (ToolPreview & {
      isLocked: false;
      longDescription: string | null;
      youtubeUrl: string | null;
      promptBody: string;
    });

export type Quota = { monthKey: string; limit: number; used: number; remaining: number };

export type Me = {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  subscription: { status: string; currentPeriodEnd: string | null; hasAccess: boolean };
  unlocks: Quota & { tools: { slug: string; unlockedAt: string }[] };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`API respondió ${status} ${code}`);
  }
}

// La web habla con la API desde el servidor (red interna de compose), así el JWT
// nunca llega al browser y el catálogo se renderiza con el estado real del usuario.
function apiUrl(path: string): string {
  const base = serverEnv('API_URL') ?? 'http://localhost:4000';
  return new URL(path, base).toString();
}

async function call<T>(
  path: string,
  user: Session['user'] | undefined,
  init: { method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const token = await signApiToken(user);
  const res = await fetch(apiUrl(path), {
    method: init.method ?? 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'unknown';
    throw new ApiError(res.status, code, body);
  }
  return body as T;
}

export async function listTools(user: Session['user'] | undefined): Promise<ToolPreview[]> {
  const { tools } = await call<{ tools: ToolPreview[] }>('/api/tools', user);
  return tools;
}

export async function getTool(
  user: Session['user'] | undefined,
  slug: string,
): Promise<ToolDetail | null> {
  try {
    const { tool } = await call<{ tool: ToolDetail }>(`/api/tools/${encodeURIComponent(slug)}`, user);
    return tool;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export type UnlockResult =
  | { ok: true; tool: ToolDetail; unlocks: Quota }
  | { ok: false; reason: 'quota_exceeded'; unlocks: Quota }
  | { ok: false; reason: 'not_found' | 'rate_limited' | 'unauthorized' };

export async function unlockTool(user: Session['user'], slug: string): Promise<UnlockResult> {
  try {
    const res = await call<{ tool: ToolDetail; unlocks: Quota }>(
      `/api/tools/${encodeURIComponent(slug)}/unlock`,
      user,
      { method: 'POST' },
    );
    return { ok: true, ...res };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === 'quota_exceeded') {
      return { ok: false, reason: 'quota_exceeded', unlocks: (err.body as { unlocks: Quota }).unlocks };
    }
    if (err.code === 'not_found' || err.code === 'rate_limited' || err.code === 'unauthorized') {
      return { ok: false, reason: err.code };
    }
    throw err;
  }
}

export async function getMe(user: Session['user'] | undefined): Promise<Me | null> {
  if (!user?.googleId) return null;
  return call<Me>('/api/me', user);
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

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
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    role: 'user' | 'admin';
  };
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

export async function call<T>(
  path: string,
  user: Session['user'] | undefined,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; json?: unknown } = {},
): Promise<T> {
  const token = await signApiToken(user);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(apiUrl(path), {
    method: init.method ?? 'GET',
    headers,
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
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

export type CourseProgress = { completed: number; total: number };
export type LessonProgress = { secondsWatched: number; completed: boolean };

export type CoursePreview = {
  slug: string;
  title: string;
  shortDescription: string;
  coverImageUrl: string | null;
  tier: 'free' | 'premium';
  publishedAt: string;
  moduleCount: number;
  lessonCount: number;
  durationSeconds: number;
  progress: CourseProgress | null;
};

export type SyllabusLesson = {
  slug: string;
  title: string;
  durationSeconds: number | null;
  isFreePreview: boolean;
  isLocked: boolean;
  progress: LessonProgress | null;
};

export type CourseDetail = Omit<CoursePreview, 'moduleCount' | 'lessonCount' | 'progress'> & {
  description: string | null;
  modules: { title: string; description: string | null; lessons: SyllabusLesson[] }[];
  progress: CourseProgress | null;
};

type LessonLink = { slug: string; title: string } | null;
type LessonBase = {
  slug: string;
  title: string;
  durationSeconds: number | null;
  isFreePreview: boolean;
  course: { slug: string; title: string; tier: 'free' | 'premium' };
  prev: LessonLink;
  next: LessonLink;
  progress: LessonProgress | null;
};
export type Lesson =
  | (LessonBase & { isLocked: true })
  | (LessonBase & { isLocked: false; youtubeUrl: string | null; contentMd: string | null });

export async function listCourses(user: Session['user'] | undefined): Promise<CoursePreview[]> {
  const { courses } = await call<{ courses: CoursePreview[] }>('/api/courses', user);
  return courses;
}

async function orNotFound<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getCourse(
  user: Session['user'] | undefined,
  slug: string,
): Promise<CourseDetail | null> {
  const res = await orNotFound(
    call<{ course: CourseDetail }>(`/api/courses/${encodeURIComponent(slug)}`, user),
  );
  return res?.course ?? null;
}

export async function getLesson(
  user: Session['user'] | undefined,
  course: string,
  lesson: string,
): Promise<Lesson | null> {
  const res = await orNotFound(
    call<{ lesson: Lesson }>(
      `/api/courses/${encodeURIComponent(course)}/lessons/${encodeURIComponent(lesson)}`,
      user,
    ),
  );
  return res?.lesson ?? null;
}

export type ProgressResult =
  | { ok: true; progress: LessonProgress }
  | { ok: false; reason: 'not_found' | 'subscription_required' | 'rate_limited' | 'unauthorized' };

export async function saveLessonProgress(
  user: Session['user'],
  course: string,
  lesson: string,
  input: { completed?: boolean; secondsWatched?: number },
): Promise<ProgressResult> {
  try {
    const { progress } = await call<{ progress: LessonProgress }>(
      `/api/courses/${encodeURIComponent(course)}/lessons/${encodeURIComponent(lesson)}/progress`,
      user,
      { method: 'PUT', json: input },
    );
    return { ok: true, progress };
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.code === 'not_found' ||
        err.code === 'subscription_required' ||
        err.code === 'rate_limited' ||
        err.code === 'unauthorized')
    ) {
      return { ok: false, reason: err.code };
    }
    throw err;
  }
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatLongDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type SubscribeResult =
  | { ok: true; initPoint: string }
  | { ok: false; reason: 'already_subscribed' | 'payment_provider_error' };

export async function createSubscription(user: Session['user']): Promise<SubscribeResult> {
  try {
    const { initPoint } = await call<{ initPoint: string }>('/api/subscription/create', user, {
      method: 'POST',
    });
    return { ok: true, initPoint };
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'already_subscribed' || err.code === 'payment_provider_error')) {
      return { ok: false, reason: err.code };
    }
    throw err;
  }
}

export type CancelResult =
  | { ok: true }
  | { ok: false; reason: 'no_active_subscription' | 'payment_provider_error' };

export async function cancelSubscription(user: Session['user']): Promise<CancelResult> {
  try {
    await call('/api/subscription/cancel', user, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'no_active_subscription' || err.code === 'payment_provider_error')) {
      return { ok: false, reason: err.code };
    }
    throw err;
  }
}

const dateFormat = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
});

export function formatDate(iso: string | null): string | null {
  return iso ? dateFormat.format(new Date(iso)) : null;
}

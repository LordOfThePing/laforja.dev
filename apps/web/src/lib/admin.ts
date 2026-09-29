import type { Session } from '@auth/core/types';
import type { AstroGlobal } from 'astro';
import { getSession } from 'auth-astro/server';
import { ApiError, type Me, call, getMe } from './api';
import { loginUrl } from './redirect';
import { slugify } from './slug';

export type AdminTool = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  longDescription: string | null;
  youtubeUrl: string | null;
  promptBody: string | null;
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

export type AdminCourse = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string | null;
  coverImageUrl: string | null;
  tier: 'free' | 'premium';
  order: number;
  publishedAt: string | null;
  createdAt: string;
};

export type AdminCourseRow = AdminCourse & { moduleCount: number; lessonCount: number };

export type AdminLessonRow = {
  id: string;
  slug: string;
  title: string;
  durationSeconds: number | null;
  isFreePreview: boolean;
  hasVideo: boolean;
};

export type AdminCourseDetail = AdminCourse & {
  learners: number;
  modules: { id: string; title: string; description: string | null; lessons: AdminLessonRow[] }[];
};

export type AdminLesson = {
  id: string;
  moduleId: string;
  courseId: string;
  slug: string;
  title: string;
  youtubeUrl: string | null;
  contentMd: string | null;
  durationSeconds: number | null;
  isFreePreview: boolean;
};

export type AdminCollection = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string | null;
  coverImageUrl: string | null;
  order: number;
  publishedAt: string | null;
  createdAt: string;
};

export type AdminCollectionItem = {
  id: string;
  kind: 'tool' | 'course';
  targetId: string;
  slug: string;
  title: string;
  note: string | null;
  publishedAt: string | null;
};

export type AdminStats = {
  users: number;
  activeSubscribers: number;
  unlocksThisMonth: number;
  tools: { total: number; published: number };
};

export type BackupRun = {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  stage: 'dump' | 'offsite' | 'done';
  file: string;
  size: number;
  offsite: 'off' | 'ok' | 'failed';
};

export type BackupStatus =
  | { available: false }
  | {
      available: true;
      alive: boolean;
      lastSeenAt: string | null;
      requested: boolean;
      config: { keepDays: number; bucket: string; provider: string } | null;
      lastRun: BackupRun | null;
      lastError: string | null;
      dumps: { name: string; size: number; modifiedAt: string }[];
    };

export type AdminMetrics = {
  months: string[];
  monthly: { month: string; newUsers: number; activeUsers: number; unlocks: number; lessonsCompleted: number }[];
  cohorts: { month: string; size: number; active: number[] }[];
  topTools: { id: string; slug: string; title: string; thisMonth: number; unlocks: number; users: number }[];
  topCourses: { id: string; slug: string; title: string; learners: number; lessonsCompleted: number; certificates: number }[];
  subscriptions: Partial<Record<'none' | 'active' | 'cancelled' | 'paused', number>>;
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

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export const listAdminCourses = (user: User) =>
  call<{ courses: AdminCourseRow[] }>('/api/admin/courses', user).then((r) => r.courses);

export const getAdminCourse = (user: User, id: string) =>
  orNull(call<{ course: AdminCourseDetail }>(`/api/admin/courses/${encodeURIComponent(id)}`, user)).then(
    (r) => r?.course ?? null,
  );

export const getAdminLesson = (user: User, id: string) =>
  orNull(call<{ lesson: AdminLesson }>(`/api/admin/lessons/${encodeURIComponent(id)}`, user)).then(
    (r) => r?.lesson ?? null,
  );

export const listCategories = (user: User) =>
  call<{ categories: AdminCategory[] }>('/api/admin/categories', user).then((r) => r.categories);

export const getMetrics = (user: User) => call<AdminMetrics>('/api/admin/metrics', user);

export const listAdminCollections = (user: User) =>
  call<{ collections: (AdminCollection & { itemCount: number })[] }>('/api/admin/collections', user).then(
    (r) => r.collections,
  );

export const getAdminCollection = (user: User, id: string) =>
  orNull(
    call<{ collection: AdminCollection & { items: AdminCollectionItem[] } }>(
      `/api/admin/collections/${encodeURIComponent(id)}`,
      user,
    ),
  ).then((r) => r?.collection ?? null);

export const getBackupStatus = (user: User) => call<BackupStatus>('/api/admin/backups', user);

export const listUsers = (user: User) =>
  call<{ users: AdminUser[] }>('/api/admin/users', user).then((r) => r.users);

export type AdminComment = {
  id: string;
  body: string;
  createdAt: string;
  tool: { slug: string; title: string };
  author: { name: string | null; email: string };
};

export const listComments = (user: User) =>
  call<{ comments: AdminComment[] }>('/api/admin/comments', user).then((r) => r.comments);

export type AdminNewsletter = {
  enabled: boolean;
  counts: { confirmed: number; pending: number; unsubscribed: number };
  subscribers: { email: string; status: 'pending' | 'confirmed' | 'unsubscribed'; createdAt: string; confirmedAt: string | null }[];
  issues: { id: string; subject: string; recipientCount: number; sentAt: string }[];
};

export const getNewsletterAdmin = (user: User) => call<AdminNewsletter>('/api/admin/newsletter', user);

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
    promptBody: str(form, 'promptBody') || null,
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

export function courseFromForm(form: FormData, current: AdminCourse | null) {
  const title = str(form, 'title');
  const publish = form.get('published') === 'on';
  return {
    slug: str(form, 'slug') || slugify(title),
    title,
    shortDescription: str(form, 'shortDescription'),
    description: str(form, 'description') || null,
    coverImageUrl: str(form, 'coverImageUrl') || null,
    tier: str(form, 'tier'),
    order: optionalInt(form, 'order') ?? 0,
    publishedAt: publish ? (current?.publishedAt ?? new Date().toISOString()) : null,
  };
}

export function collectionFromForm(form: FormData, current: AdminCollection | null) {
  const title = str(form, 'title');
  const publish = form.get('published') === 'on';
  return {
    slug: str(form, 'slug') || slugify(title),
    title,
    shortDescription: str(form, 'shortDescription'),
    description: str(form, 'description') || null,
    coverImageUrl: str(form, 'coverImageUrl') || null,
    order: optionalInt(form, 'order') ?? 0,
    publishedAt: publish ? (current?.publishedAt ?? new Date().toISOString()) : null,
  };
}

// El select del alta manda "tool:<id>" o "course:<id>": un solo control para elegir entre los dos.
export function collectionItemFromForm(form: FormData) {
  const [kind, id] = str(form, 'target').split(':');
  const note = str(form, 'note') || null;
  if (kind === 'tool' && id) return { toolId: id, note };
  if (kind === 'course' && id) return { courseId: id, note };
  return { note };
}

export function moduleFromForm(form: FormData) {
  return { title: str(form, 'title'), description: str(form, 'description') || null };
}

export function lessonFromForm(form: FormData) {
  const title = str(form, 'title');
  const minutes = optionalInt(form, 'durationMinutes');
  const moduleId = str(form, 'moduleId');
  return {
    ...(moduleId ? { moduleId } : {}),
    slug: str(form, 'slug') || slugify(title),
    title,
    youtubeUrl: str(form, 'youtubeUrl') || null,
    contentMd: str(form, 'contentMd') || null,
    durationSeconds: minutes === null ? null : Math.round(minutes * 60),
    isFreePreview: form.get('isFreePreview') === 'on',
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
  promptBody: 'el prompt (opcional)',
  tier: 'el tier',
  categoryId: 'la categoría',
  youtubeUrl: 'la URL de YouTube',
  coverImageUrl: 'la URL de la portada',
  durationSeconds: 'la duración',
  order: 'el orden',
  tags: 'los tags',
  description: 'la descripción',
  contentMd: 'el contenido',
  moduleId: 'el módulo',
  isFreePreview: 'la opción de preview',
  direction: 'la dirección',
  target: 'qué herramienta o curso agregar',
  toolId: 'la herramienta',
  courseId: 'el curso',
  note: 'la nota',
  subject: 'el asunto',
  body: 'el texto',
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
    item_taken: 'Eso ya está en la ruta.',
    backups_unavailable: 'Los backups no se pueden manejar desde este entorno.',
    backup_state_unwritable: 'El servicio de backup todavía no preparó su carpeta. Probá en un minuto.',
    newsletter_disabled: 'La newsletter está apagada: falta RESEND_API_KEY en la api.',
    no_recipients: 'No hay suscriptores confirmados todavía.',
    mailer_error: 'Resend rechazó el envío. Revisá la key y el dominio verificado.',
  };
  return messages[result.error] ?? 'Algo salió mal. Probá de nuevo.';
}

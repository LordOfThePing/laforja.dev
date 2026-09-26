import type { AuthUser } from '../auth.ts';
import { hasFullAccess } from './access.ts';

// Los cursos no consumen el cupo de unlocks: la suscripción es la que abre todo (roadmap v2).
// Una lección de preview se ve sin login, igual que una herramienta free.
export function canViewLesson(
  course: { tier: 'free' | 'premium' },
  lesson: { isFreePreview: boolean },
  user: AuthUser | null,
): boolean {
  if (course.tier === 'free' || lesson.isFreePreview) return true;
  return user !== null && hasFullAccess(user);
}

export type ProgressInput = { secondsWatched?: number; completed?: boolean };

// Tope defensivo: ninguna lección dura un día, y evita que un cliente roto infle el contador.
const MAX_SECONDS = 24 * 60 * 60;

export function parseProgressInput(body: unknown): ProgressInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { secondsWatched, completed } = body as Record<string, unknown>;
  const out: ProgressInput = {};
  if (secondsWatched !== undefined) {
    if (
      typeof secondsWatched !== 'number' ||
      !Number.isInteger(secondsWatched) ||
      secondsWatched < 0 ||
      secondsWatched > MAX_SECONDS
    ) {
      return null;
    }
    out.secondsWatched = secondsWatched;
  }
  if (completed !== undefined) {
    if (typeof completed !== 'boolean') return null;
    out.completed = completed;
  }
  if (out.secondsWatched === undefined && out.completed === undefined) return null;
  return out;
}

import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { unlocks } from '../db/schema.ts';
import { type Access, accessLevel, hasFullAccess } from './access.ts';

// Cupo mensual de desbloqueos por nivel. El plan Maestro no gasta cupo (acceso total).
export const APRENDIZ_UNLOCKS_PER_MONTH = 1;
export const OFICIAL_UNLOCKS_PER_MONTH = 3;

export type Viewer = {
  user: AuthUser | null;
  unlockedToolIds: ReadonlySet<string>;
};

export async function unlockedToolIds(
  db: Pick<Db, 'select'>,
  userId: string,
  month: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ toolId: unlocks.toolId })
    .from(unlocks)
    .where(and(eq(unlocks.userId, userId), eq(unlocks.monthKey, month)));
  return new Set(rows.map((r) => r.toolId));
}

export function canView(tool: { id: string; tier: 'free' | 'premium' }, viewer: Viewer): boolean {
  if (tool.tier === 'free') return true;
  if (!viewer.user) return false;
  if (hasFullAccess(viewer.user)) return true;
  return viewer.unlockedToolIds.has(tool.id);
}

export function unlockLimitFor(access: Access): number {
  if (access === 'oficial') return OFICIAL_UNLOCKS_PER_MONTH;
  return APRENDIZ_UNLOCKS_PER_MONTH;
}

export function quotaSummary(user: AuthUser, used: number) {
  const access = accessLevel(user);
  const limit = unlockLimitFor(access);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

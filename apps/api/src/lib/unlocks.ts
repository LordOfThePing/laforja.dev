import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { unlocks } from '../db/schema.ts';
import { hasFullAccess } from './access.ts';

export const FREE_UNLOCKS_PER_MONTH = 2;

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

export function quotaSummary(used: number) {
  return {
    limit: FREE_UNLOCKS_PER_MONTH,
    used,
    remaining: Math.max(0, FREE_UNLOCKS_PER_MONTH - used),
  };
}

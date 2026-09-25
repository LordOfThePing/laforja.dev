import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthEnv, requireAuth } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { tools, unlocks } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import { monthKey } from '../lib/month.ts';
import { quotaSummary } from '../lib/unlocks.ts';

export function meRoutes(db: Db, authSecret: string) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(db, authSecret));

  app.get('/', async (c) => {
    const user = c.get('user');
    const currentMonth = monthKey();

    const unlockedThisMonth = await db
      .select({ slug: tools.slug, unlockedAt: unlocks.unlockedAt })
      .from(unlocks)
      .innerJoin(tools, eq(unlocks.toolId, tools.id))
      .where(and(eq(unlocks.userId, user.id), eq(unlocks.monthKey, currentMonth)))
      .orderBy(desc(unlocks.unlockedAt));

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      subscription: {
        status: user.subscriptionStatus,
        currentPeriodEnd: user.currentPeriodEnd,
        hasAccess: hasSubscriptionAccess(user),
      },
      unlocks: {
        monthKey: currentMonth,
        ...quotaSummary(unlockedThisMonth.length),
        tools: unlockedThisMonth,
      },
    });
  });

  return app;
}

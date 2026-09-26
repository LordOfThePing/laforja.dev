import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAuth } from '../auth.ts';
import { tools, unlocks } from '../db/schema.ts';
import { hasSubscriptionAccess } from '../lib/access.ts';
import { monthKey } from '../lib/month.ts';
import { quotaSummary } from '../lib/unlocks.ts';

export function meRoutes(auth: AuthConfig) {
  const { db } = auth;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(auth));

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
        role: user.role,
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

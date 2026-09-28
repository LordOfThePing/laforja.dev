import { and, count, countDistinct, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AuthEnv } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { certificates, courses, lessons, progress, tools, unlocks, userActivity, users } from '../db/schema.ts';
import { monthKey } from '../lib/month.ts';

export const METRICS_MONTHS = 6;
const TOP_LIMIT = 10;

// Mismo huso que month_key (lib/month.ts), para que un alta del 31 a la noche caiga en el mes correcto.
const monthOf = (column: typeof users.createdAt | typeof progress.completedAt) =>
  sql<string>`to_char(${column} at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')`;

// Las métricas son de usuarios: los admins entran a probar y ensuciarían la retención.
const isCustomer = eq(users.role, 'user');

export function lastMonths(n: number, now = new Date()): string[] {
  const [year, month] = monthKey(now).split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function byMonth(rows: { month: string; n: number }[]): Map<string, number> {
  return new Map(rows.map((r) => [r.month, Number(r.n)]));
}

export async function readMetrics(db: Db, now = new Date()) {
  const months = lastMonths(METRICS_MONTHS, now);
  const from = months[0]!;
  const current = months[months.length - 1]!;
  const signupMonth = monthOf(users.createdAt);
  const completedMonth = monthOf(progress.completedAt);

  const [newUsers, activeUsers, unlocksPerMonth, completions, cohortRows, topTools, topCourses, subs] =
    await Promise.all([
      db
        .select({ month: signupMonth, n: count() })
        .from(users)
        .where(and(isCustomer, sql`${signupMonth} >= ${from}`))
        .groupBy(signupMonth),
      db
        .select({ month: userActivity.monthKey, n: count() })
        .from(userActivity)
        .innerJoin(users, eq(userActivity.userId, users.id))
        .where(and(isCustomer, gte(userActivity.monthKey, from)))
        .groupBy(userActivity.monthKey),
      db
        .select({ month: unlocks.monthKey, n: count() })
        .from(unlocks)
        .innerJoin(users, eq(unlocks.userId, users.id))
        .where(and(isCustomer, gte(unlocks.monthKey, from)))
        .groupBy(unlocks.monthKey),
      db
        .select({ month: completedMonth, n: count() })
        .from(progress)
        .innerJoin(users, eq(progress.userId, users.id))
        .where(and(isCustomer, isNotNull(progress.completedAt), sql`${completedMonth} >= ${from}`))
        .groupBy(completedMonth),
      db
        .select({ cohort: signupMonth, month: userActivity.monthKey, n: count() })
        .from(userActivity)
        .innerJoin(users, eq(userActivity.userId, users.id))
        .where(and(isCustomer, sql`${signupMonth} >= ${from}`))
        .groupBy(signupMonth, userActivity.monthKey),
      db
        .select({
          id: tools.id,
          slug: tools.slug,
          title: tools.title,
          thisMonth: sql<number>`count(*) filter (where ${unlocks.monthKey} = ${current})`.mapWith(Number),
          unlocks: count(),
          users: countDistinct(unlocks.userId),
        })
        .from(unlocks)
        .innerJoin(tools, eq(unlocks.toolId, tools.id))
        .innerJoin(users, eq(unlocks.userId, users.id))
        .where(and(isCustomer, gte(unlocks.monthKey, from)))
        .groupBy(tools.id)
        .orderBy(desc(count()), tools.title)
        .limit(TOP_LIMIT),
      db
        .select({
          id: courses.id,
          slug: courses.slug,
          title: courses.title,
          learners: countDistinct(progress.userId),
          lessonsCompleted: sql<number>`count(${progress.completedAt})`.mapWith(Number),
          certificates: sql<number>`(select count(*) from ${certificates} where ${certificates.courseId} = ${courses.id})`.mapWith(Number),
        })
        .from(progress)
        .innerJoin(users, eq(progress.userId, users.id))
        .innerJoin(lessons, eq(progress.lessonId, lessons.id))
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(isCustomer)
        .groupBy(courses.id)
        .orderBy(desc(countDistinct(progress.userId)), courses.title)
        .limit(TOP_LIMIT),
      db
        .select({ status: users.subscriptionStatus, n: count() })
        .from(users)
        .where(isCustomer)
        .groupBy(users.subscriptionStatus),
    ]);

  const created = byMonth(newUsers);
  const active = byMonth(activeUsers);
  const unlocked = byMonth(unlocksPerMonth);
  const completed = byMonth(completions);
  const cohortActive = new Map(cohortRows.map((r) => [`${r.cohort}|${r.month}`, Number(r.n)]));

  return {
    months,
    monthly: months.map((month) => ({
      month,
      newUsers: created.get(month) ?? 0,
      activeUsers: active.get(month) ?? 0,
      unlocks: unlocked.get(month) ?? 0,
      lessonsCompleted: completed.get(month) ?? 0,
    })),
    // active[k] = cuántos del cohorte usaron el sitio k meses después de registrarse.
    cohorts: months.map((month, i) => ({
      month,
      size: created.get(month) ?? 0,
      active: months.slice(i).map((m) => cohortActive.get(`${month}|${m}`) ?? 0),
    })),
    topTools,
    topCourses,
    subscriptions: Object.fromEntries(subs.map((r) => [r.status, Number(r.n)])) as Partial<
      Record<(typeof users.subscriptionStatus.enumValues)[number], number>
    >,
  };
}

export function adminMetricsRoutes(db: Db) {
  const app = new Hono<AuthEnv>();
  app.get('/metrics', async (c) => c.json(await readMetrics(db)));
  return app;
}

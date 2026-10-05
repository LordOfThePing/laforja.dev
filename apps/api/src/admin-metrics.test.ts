import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { lessons, progress, userActivity, users } from './db/schema.ts';
import { monthKey } from './lib/month.ts';
import { lastMonths, type readMetrics } from './routes/admin-metrics.ts';
import { createTestApp, makeToken } from './test/setup.ts';

type Metrics = Awaited<ReturnType<typeof readMetrics>>;

let app: ReturnType<typeof createApp>;
let db: Db;
let adminToken: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  adminToken = await makeToken({ sub: 'google-admin', email: 'admin@example.com' });
});

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

let seq = 0;
async function newUser() {
  seq += 1;
  const token = await makeToken({ sub: `google-m${seq}`, email: `m${seq}@example.com` });
  const me = (await (await app.request('/api/me', auth(token))).json()) as { user: { id: string } };
  return { token, id: me.user.id };
}

const unlock = (slug: string, token: string) =>
  app.request(`/api/tools/${slug}/unlock`, { method: 'POST', ...auth(token) });

async function metrics(): Promise<Metrics> {
  const res = await app.request('/api/admin/metrics', auth(adminToken));
  expect(res.status).toBe(200);
  return (await res.json()) as Metrics;
}

describe('lastMonths', () => {
  test('cruza el año y termina en el mes actual (hora de Argentina)', () => {
    // 1 de febrero 01:00 UTC = 31 de enero 22:00 en Argentina.
    expect(lastMonths(3, new Date('2026-02-01T01:00:00Z'))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('actividad mensual', () => {
  test('cada usuario queda una sola vez por mes aunque haga muchos requests', async () => {
    const { token, id } = await newUser();
    await app.request('/api/me', auth(token));
    await app.request('/api/tools', auth(token));
    const rows = await db.select().from(userActivity).where(eq(userActivity.userId, id));
    expect(rows.map((r) => r.monthKey)).toEqual([monthKey()]);
  });
});

describe('GET /api/admin/metrics', () => {
  test('solo admins', async () => {
    const { token } = await newUser();
    expect((await app.request('/api/admin/metrics', auth(token))).status).toBe(404);
    expect((await app.request('/api/admin/metrics')).status).toBe(401);
  });

  test('top de desbloqueos, series del mes y sin contar a los admins', async () => {
    const before = await metrics();
    const a = await newUser();
    const b = await newUser();
    // b queda en plan Oficial (basic) para poder consumir dos desbloqueos en el mes.
    await db
      .update(users)
      .set({ subscriptionStatus: 'active', subscriptionPlan: 'basic' })
      .where(eq(users.id, b.id));
    expect((await unlock('code-review-agentico', a.token)).status).toBe(201);
    expect((await unlock('code-review-agentico', b.token)).status).toBe(201);
    expect((await unlock('prompt-debug', b.token)).status).toBe(201);
    await unlock('prompt-debug', adminToken);

    const after = await metrics();
    const current = after.monthly.at(-1)!;
    const prev = before.monthly.at(-1)!;
    expect(current.month).toBe(monthKey());
    expect(current.newUsers - prev.newUsers).toBe(2);
    expect(current.activeUsers - prev.activeUsers).toBe(2);
    expect(current.unlocks - prev.unlocks).toBe(3);

    const [first, second] = after.topTools;
    expect(first).toMatchObject({ slug: 'code-review-agentico', unlocks: 2, users: 2, thisMonth: 2 });
    expect(second).toMatchObject({ slug: 'prompt-debug', unlocks: 1, users: 1 });

    const all = Object.values(after.subscriptions).reduce((sum, n) => sum + (n ?? 0), 0);
    expect(all).toBe(await db.$count(users, eq(users.role, 'user')));
  });

  test('cohortes: quién volvió los meses siguientes al alta', async () => {
    const months = lastMonths(6);
    const cohort = months[3]!;
    const signup = new Date(`${cohort}-15T15:00:00Z`);
    const inserted = await db
      .insert(users)
      .values([1, 2, 3].map((i) => ({ googleId: `cohorte-${i}`, email: `cohorte${i}@example.com`, createdAt: signup })))
      .returning({ id: users.id });
    const ids = inserted.map((u) => u.id);
    await db.insert(userActivity).values([
      ...ids.map((userId) => ({ userId, monthKey: cohort })),
      { userId: ids[0]!, monthKey: months[4]! },
      { userId: ids[1]!, monthKey: months[4]! },
      { userId: ids[0]!, monthKey: months[5]! },
    ]);

    const row = (await metrics()).cohorts.find((c) => c.month === cohort)!;
    expect(row).toEqual({ month: cohort, size: 3, active: [3, 2, 1] });
  });

  test('cursos: alumnos y lecciones completadas', async () => {
    const { id } = await newUser();
    const [lesson] = await db.select({ id: lessons.id, courseId: lessons.courseId }).from(lessons).limit(1);
    await db.insert(progress).values({ userId: id, lessonId: lesson!.id, secondsWatched: 60, completedAt: new Date() });

    const course = (await metrics()).topCourses.find((c) => c.id === lesson!.courseId)!;
    expect(course).toMatchObject({ learners: 1, lessonsCompleted: 1, certificates: 0 });
  });
});

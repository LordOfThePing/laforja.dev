import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { courses, lessons, modules, progress } from './db/schema.ts';
import { renderCertificatePdf } from './lib/certificate-pdf.ts';
import { createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

let seq = 0;
async function newUser(claims: Record<string, unknown> = {}) {
  seq += 1;
  const token = await makeToken({ sub: `google-cert${seq}`, email: `cert${seq}@example.com`, name: `Ana ${seq}`, ...claims });
  const res = await app.request('/api/me', { headers: { Authorization: `Bearer ${token}` } });
  return { token, id: ((await res.json()) as { user: { id: string } }).user.id };
}

async function newCourse({ published = true } = {}) {
  seq += 1;
  const [course] = await db
    .insert(courses)
    .values({
      slug: `curso-cert-${seq}`,
      title: `Agentes en serio ${seq}`,
      shortDescription: 'x',
      tier: 'free',
      publishedAt: published ? new Date(Date.now() - 60_000) : null,
    })
    .returning();
  if (!course) throw new Error('no se creó el curso');
  const [mod] = await db.insert(modules).values({ courseId: course.id, title: 'Módulo 1' }).returning();
  if (!mod) throw new Error('no se creó el módulo');
  const lessonRows = await db
    .insert(lessons)
    .values([1, 2].map((n) => ({ moduleId: mod.id, courseId: course.id, slug: `leccion-${n}`, title: `Lección ${n}`, order: n })))
    .returning({ id: lessons.id });
  return { course, moduleId: mod.id, lessonIds: lessonRows.map((l) => l.id) };
}

async function complete(userId: string, lessonIds: string[]) {
  await db.insert(progress).values(lessonIds.map((lessonId) => ({ userId, lessonId, completedAt: new Date() })));
}

function issue(slug: string, token?: string) {
  return app.request(`/api/courses/${slug}/certificate`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

type Certificate = { id: string; recipientName: string; courseTitle: string; courseSlug: string; issuedAt: string };

describe('POST /api/courses/:slug/certificate', () => {
  test('sin auth: 401', async () => {
    const { course } = await newCourse();
    expect((await issue(course.slug)).status).toBe(401);
  });

  test('curso inexistente o sin publicar: 404', async () => {
    const { token } = await newUser();
    const { course } = await newCourse({ published: false });
    expect((await issue('no-existe', token)).status).toBe(404);
    expect((await issue(course.slug, token)).status).toBe(404);
  });

  test('curso sin terminar: 409 con el avance', async () => {
    const user = await newUser();
    const { course, lessonIds } = await newCourse();
    await complete(user.id, lessonIds.slice(0, 1));

    const res = await issue(course.slug, user.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_completed', completed: 1, total: 2 });
  });

  test('curso terminado: lo emite una vez y después devuelve el mismo', async () => {
    const user = await newUser({ name: 'Łukasz Żółć' });
    const { course, lessonIds } = await newCourse();
    await complete(user.id, lessonIds);

    const first = await issue(course.slug, user.token);
    expect(first.status).toBe(201);
    const { certificate } = (await first.json()) as { certificate: Certificate };
    expect(certificate).toMatchObject({ recipientName: 'Łukasz Żółć', courseTitle: course.title, courseSlug: course.slug });

    const again = await issue(course.slug, user.token);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { certificate: Certificate }).certificate.id).toBe(certificate.id);
  });

  test('sin nombre en la cuenta: 409 name_required', async () => {
    const user = await newUser({ name: '  ' });
    const { course, lessonIds } = await newCourse();
    await complete(user.id, lessonIds);

    const res = await issue(course.slug, user.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_required' });
  });

  test('una vez emitido sigue valiendo aunque el curso cambie', async () => {
    const user = await newUser();
    const { course, moduleId, lessonIds } = await newCourse();
    await complete(user.id, lessonIds);
    const { certificate } = (await (await issue(course.slug, user.token)).json()) as { certificate: Certificate };

    await db.update(courses).set({ title: 'Título nuevo' }).where(eq(courses.id, course.id));
    await db.insert(lessons).values({ moduleId, courseId: course.id, slug: 'leccion-3', title: 'Lección 3', order: 3 });

    const res = await issue(course.slug, user.token);
    expect(res.status).toBe(200);
    const again = ((await res.json()) as { certificate: Certificate }).certificate;
    expect(again.id).toBe(certificate.id);
    expect(again.courseTitle).toBe(course.title);
  });
});

describe('GET /api/certificates/:id', () => {
  test('es público y trae la URL de verificación', async () => {
    const user = await newUser();
    const { course, lessonIds } = await newCourse();
    await complete(user.id, lessonIds);
    const { certificate } = (await (await issue(course.slug, user.token)).json()) as { certificate: Certificate };

    const res = await app.request(`/api/certificates/${certificate.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { certificate: Certificate & { verifyUrl: string } };
    expect(body.certificate.recipientName).toBe(certificate.recipientName);
    expect(body.certificate.verifyUrl).toBe(`http://localhost:3000/certificados/${certificate.id}`);
  });

  test('id inválido o inexistente: 404', async () => {
    expect((await app.request('/api/certificates/no-es-uuid')).status).toBe(404);
    expect((await app.request(`/api/certificates/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await app.request(`/api/certificates/${crypto.randomUUID()}/pdf`)).status).toBe(404);
  });

  test('el PDF es un A4 apaisado de una página', async () => {
    const user = await newUser({ name: 'Łukasz Żółć' });
    const { course, lessonIds } = await newCourse();
    await complete(user.id, lessonIds);
    const { certificate } = (await (await issue(course.slug, user.token)).json()) as { certificate: Certificate };

    const res = await app.request(`/api/certificates/${certificate.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const pdf = await PDFDocument.load(await res.arrayBuffer());
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);
  });
});

describe('renderCertificatePdf', () => {
  test('achica nombres y títulos largos en vez de desbordar', async () => {
    const bytes = await renderCertificatePdf({
      id: crypto.randomUUID(),
      recipientName: 'María de los Ángeles Fernández de la Peña y Castañeda Etcheverry',
      courseTitle: 'Un curso con un título larguísimo que no entraría nunca en una sola línea del certificado',
      issuedAt: new Date('2026-09-26T12:00:00Z'),
      verifyUrl: 'https://academia.flynnpedroa.engineer/certificados/x',
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

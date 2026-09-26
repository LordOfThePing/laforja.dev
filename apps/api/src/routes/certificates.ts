import { and, count, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { type AuthConfig, type AuthEnv, requireAuth } from '../auth.ts';
import { certificates, courses, lessons, progress } from '../db/schema.ts';
import { isUuid } from '../lib/admin-input.ts';
import { renderCertificatePdf } from '../lib/certificate-pdf.ts';

const certificateColumns = {
  id: certificates.id,
  recipientName: certificates.recipientName,
  courseTitle: certificates.courseTitle,
  courseSlug: courses.slug,
  issuedAt: certificates.issuedAt,
};

export function certificatesRoutes(auth: AuthConfig, frontendUrl: string) {
  const { db } = auth;
  const app = new Hono<AuthEnv>();
  const verifyUrl = (id: string) => `${frontendUrl.replace(/\/$/, '')}/certificados/${id}`;

  function findIssued(userId: string, courseId: string) {
    return db
      .select({ id: certificates.id })
      .from(certificates)
      .where(and(eq(certificates.userId, userId), eq(certificates.courseId, courseId)))
      .then((rows) => rows[0]);
  }

  function findCertificate(id: string) {
    return db
      .select(certificateColumns)
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(eq(certificates.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }

  // Idempotente: si ya lo tiene devuelve el mismo, así el botón de la web puede ser un POST
  // simple que siempre termina en la página del certificado.
  app.post('/courses/:slug/certificate', requireAuth(auth), async (c) => {
    const user = c.get('user');
    const [course] = await db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(
        and(
          eq(courses.slug, c.req.param('slug')),
          isNotNull(courses.publishedAt),
          lte(courses.publishedAt, sql`now()`),
        ),
      )
      .limit(1);
    if (!course) return c.json({ error: 'not_found' }, 404);

    const existing = await findIssued(user.id, course.id);
    if (existing) return c.json({ certificate: await findCertificate(existing.id) });

    const [[total], [done]] = await Promise.all([
      db.select({ n: count() }).from(lessons).where(eq(lessons.courseId, course.id)),
      db
        .select({ n: count() })
        .from(progress)
        .innerJoin(lessons, eq(progress.lessonId, lessons.id))
        .where(and(eq(progress.userId, user.id), eq(lessons.courseId, course.id), isNotNull(progress.completedAt))),
    ]);
    const lessonCount = total?.n ?? 0;
    const completed = done?.n ?? 0;
    if (lessonCount === 0 || completed < lessonCount) {
      return c.json({ error: 'not_completed', completed, total: lessonCount }, 409);
    }
    // El nombre sale público en la verificación: sin nombre no se usa el email de reemplazo.
    const name = user.name?.trim();
    if (!name) return c.json({ error: 'name_required' }, 409);

    // Con dos requests a la vez, el que pierde contra el unique lee el que ganó.
    const [created] = await db
      .insert(certificates)
      .values({ userId: user.id, courseId: course.id, recipientName: name, courseTitle: course.title })
      .onConflictDoNothing()
      .returning({ id: certificates.id });
    const id = created?.id ?? (await findIssued(user.id, course.id))?.id;
    if (!id) throw new Error('certificado emitido pero no encontrado');
    return c.json({ certificate: await findCertificate(id) }, created ? 201 : 200);
  });

  app.get('/certificates/:id', async (c) => {
    const id = c.req.param('id');
    const certificate = isUuid(id) ? await findCertificate(id) : undefined;
    if (!certificate) return c.json({ error: 'not_found' }, 404);
    return c.json({ certificate: { ...certificate, verifyUrl: verifyUrl(id) } });
  });

  app.get('/certificates/:id/pdf', async (c) => {
    const id = c.req.param('id');
    const certificate = isUuid(id) ? await findCertificate(id) : undefined;
    if (!certificate) return c.json({ error: 'not_found' }, 404);
    const pdf = await renderCertificatePdf({ ...certificate, verifyUrl: verifyUrl(id) });
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="certificado-la-forja-${certificate.courseSlug}.pdf"`,
      // Un certificado emitido no cambia: el id es inmutable y el contenido es un snapshot.
      'Cache-Control': 'public, max-age=86400',
    });
  });

  return app;
}

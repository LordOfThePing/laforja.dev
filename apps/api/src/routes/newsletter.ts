import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { newsletterSubscribers } from '../db/schema.ts';
import type { Mailer } from '../lib/mailer.ts';
import { confirmationEmail, isToken, newToken, parseEmail, parseToken } from '../lib/newsletter.ts';
import { type RateLimitRule, clientIp, rateLimit } from '../lib/rate-limit.ts';

type Options = { db: Db; mailer: Mailer | null; frontendUrl: string; limit: RateLimitRule };

export function newsletterRoutes({ db, mailer, frontendUrl, limit }: Options) {
  const app = new Hono();

  app.get('/status', (c) => c.json({ enabled: mailer !== null }));

  // Misma respuesta para dirección nueva, pendiente o ya confirmada: el endpoint no sirve para
  // averiguar quién está suscripto.
  app.post('/subscribe', rateLimit(limit, clientIp), async (c) => {
    if (!mailer) return c.json({ error: 'newsletter_disabled' }, 503);
    const email = parseEmail(await c.req.json().catch(() => null));
    if (!email) return c.json({ error: 'invalid_email' }, 400);

    const [existing] = await db
      .select({ status: newsletterSubscribers.status, token: newsletterSubscribers.token })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email));

    if (existing?.status === 'confirmed') return c.json({ ok: true }, 202);

    let token = existing?.token;
    if (!existing) {
      // Si otra alta de la misma dirección ganó la carrera, se reenvía con el token que quedó.
      const [inserted] = await db
        .insert(newsletterSubscribers)
        .values({ email, token: newToken() })
        .onConflictDoUpdate({ target: newsletterSubscribers.email, set: { email } })
        .returning({ token: newsletterSubscribers.token, status: newsletterSubscribers.status });
      if (inserted!.status === 'confirmed') return c.json({ ok: true }, 202);
      token = inserted!.token;
    } else if (existing.status === 'unsubscribed') {
      // Token nuevo: el link de baja de envíos viejos no tiene que servir para confirmar.
      token = newToken();
      await db
        .update(newsletterSubscribers)
        .set({ status: 'pending', token, unsubscribedAt: null })
        .where(eq(newsletterSubscribers.email, email));
    }

    const { subject, html, text } = confirmationEmail(`${frontendUrl}/newsletter/confirmar?token=${token}`);
    await mailer.sendBatch([{ to: email, subject, html, text }]);
    return c.json({ ok: true }, 202);
  });

  app.post('/confirm', async (c) => {
    const token = parseToken(await c.req.json().catch(() => null));
    if (!token) return c.json({ error: 'not_found' }, 404);
    // Una baja no se deshace con el link viejo de confirmación: hay que volver a suscribirse.
    const [row] = await db
      .update(newsletterSubscribers)
      .set({
        status: 'confirmed',
        confirmedAt: sql`coalesce(${newsletterSubscribers.confirmedAt}, now())`,
      })
      .where(sql`${newsletterSubscribers.token} = ${token} and ${newsletterSubscribers.status} <> 'unsubscribed'`)
      .returning({ email: newsletterSubscribers.email });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true, email: row.email });
  });

  async function unsubscribe(token: string) {
    const [row] = await db
      .update(newsletterSubscribers)
      .set({
        status: 'unsubscribed',
        unsubscribedAt: sql`coalesce(${newsletterSubscribers.unsubscribedAt}, now())`,
      })
      .where(eq(newsletterSubscribers.token, token))
      .returning({ email: newsletterSubscribers.email });
    return row;
  }

  app.post('/unsubscribe', async (c) => {
    const token = parseToken(await c.req.json().catch(() => null));
    const row = token ? await unsubscribe(token) : undefined;
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true, email: row.email });
  });

  // RFC 8058: el cliente de correo hace un POST sin cookies ni JS cuando tocás "Desuscribirse".
  // Va directo a la api (el tunnel manda /api/* acá) porque el checkOrigin de Astro lo rechazaría.
  app.post('/unsubscribe/one-click', async (c) => {
    const token = c.req.query('token');
    if (!isToken(token) || !(await unsubscribe(token))) return c.text('Link inválido', 404);
    return c.text('Listo, te diste de baja.');
  });

  return app;
}

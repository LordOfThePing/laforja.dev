import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AuthEnv } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { newsletterIssues, newsletterSubscribers } from '../db/schema.ts';
import { BATCH_SIZE, type Mailer, MailerError } from '../lib/mailer.ts';
import { issueEmail, parseIssueInput } from '../lib/newsletter.ts';

// Resend deja 2 requests por segundo por defecto: entre lotes se espera un poco más que eso.
const BATCH_PAUSE_MS = 600;

export function adminNewsletterRoutes(db: Db, mailer: Mailer | null, frontendUrl: string) {
  const app = new Hono<AuthEnv>();

  const unsubscribeLinks = (token: string) => ({
    page: `${frontendUrl}/newsletter/baja?token=${token}`,
    oneClick: `${frontendUrl}/api/newsletter/unsubscribe/one-click?token=${token}`,
  });

  app.get('/newsletter', async (c) => {
    const [counts, subscribers, issues] = await Promise.all([
      db
        .select({ status: newsletterSubscribers.status, n: count() })
        .from(newsletterSubscribers)
        .groupBy(newsletterSubscribers.status),
      db
        .select({
          email: newsletterSubscribers.email,
          status: newsletterSubscribers.status,
          createdAt: newsletterSubscribers.createdAt,
          confirmedAt: newsletterSubscribers.confirmedAt,
        })
        .from(newsletterSubscribers)
        .orderBy(desc(newsletterSubscribers.createdAt))
        .limit(200),
      db
        .select({
          id: newsletterIssues.id,
          subject: newsletterIssues.subject,
          recipientCount: newsletterIssues.recipientCount,
          sentAt: newsletterIssues.sentAt,
        })
        .from(newsletterIssues)
        .orderBy(desc(newsletterIssues.sentAt))
        .limit(50),
    ]);
    const by = new Map(counts.map((r) => [r.status, r.n]));
    return c.json({
      enabled: mailer !== null,
      counts: { confirmed: by.get('confirmed') ?? 0, pending: by.get('pending') ?? 0, unsubscribed: by.get('unsubscribed') ?? 0 },
      subscribers,
      issues,
    });
  });

  app.post('/newsletter/issues', async (c) => {
    if (!mailer) return c.json({ error: 'newsletter_disabled' }, 503);
    const input = parseIssueInput(await c.req.json().catch(() => null));
    if ('error' in input) return c.json(input, 400);
    const admin = c.get('user');

    // La prueba va solo al admin, con un link de baja que no apunta a nadie, y no queda en el historial.
    if (input.test) {
      const { html, text } = issueEmail(input.subject, input.body, `${frontendUrl}/newsletter/baja`);
      await mailer.sendBatch([{ to: admin.email, subject: `[Prueba] ${input.subject}`, html, text }]);
      return c.json({ sent: 1, test: true });
    }

    const recipients = await db
      .select({ email: newsletterSubscribers.email, token: newsletterSubscribers.token })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.status, 'confirmed'));
    if (recipients.length === 0) return c.json({ error: 'no_recipients' }, 409);

    let sent = 0;
    let failure: MailerError | null = null;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      if (i > 0) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      const batch = recipients.slice(i, i + BATCH_SIZE).map(({ email, token }) => {
        const links = unsubscribeLinks(token);
        const { html, text } = issueEmail(input.subject, input.body, links.page);
        return {
          to: email,
          subject: input.subject,
          html,
          text,
          headers: {
            'List-Unsubscribe': `<${links.oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        };
      });
      try {
        await mailer.sendBatch(batch);
        sent += batch.length;
      } catch (err) {
        if (!(err instanceof MailerError)) throw err;
        failure = err;
        break;
      }
    }

    if (sent > 0) {
      await db
        .insert(newsletterIssues)
        .values({ subject: input.subject, body: input.body, recipientCount: sent, sentBy: admin.id });
    }
    if (failure) {
      console.error('newsletter: Resend cortó el envío', failure);
      return c.json({ error: 'mailer_error', sent, total: recipients.length }, 502);
    }
    return c.json({ sent, test: false });
  });

  return app;
}

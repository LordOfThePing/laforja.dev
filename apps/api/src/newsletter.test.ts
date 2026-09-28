import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { newsletterIssues, newsletterSubscribers } from './db/schema.ts';
import { issueEmail, parseEmail } from './lib/newsletter.ts';
import type { FakeMailer } from './test/fake-mailer.ts';
import { TEST_ADMIN_EMAIL, createTestApp, makeToken } from './test/setup.ts';

let app: ReturnType<typeof createApp>;
let db: Db;
let mailer: FakeMailer;

beforeAll(async () => {
  const t = await createTestApp({ newsletter: { limit: 1000, windowMs: 60_000 } });
  ({ app, db } = t);
  mailer = t.mailer!;
});

beforeEach(() => mailer.reset());

function req(method: string, path: string, json?: unknown, headers: Record<string, string> = {}) {
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
}

const subscribe = (email: string) => req('POST', '/api/newsletter/subscribe', { email });

async function row(email: string) {
  const [r] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email));
  return r;
}

function tokenFromMail(): string {
  const text = mailer.sent.at(-1)!.text;
  return text.match(/token=([0-9a-f]{64})/)![1]!;
}

let seq = 0;
async function confirmed() {
  seq += 1;
  const email = `lector${seq}@example.com`;
  await subscribe(email);
  const token = tokenFromMail();
  await req('POST', '/api/newsletter/confirm', { token });
  return { email, token };
}

describe('parseEmail / issueEmail', () => {
  test('normaliza y valida', () => {
    expect(parseEmail({ email: '  Ana@Example.COM ' })).toBe('ana@example.com');
    expect(parseEmail({ email: 'sin-arroba' })).toBeNull();
    expect(parseEmail({ email: 'a@b' })).toBeNull();
    expect(parseEmail({})).toBeNull();
  });

  test('escapa HTML antes de linkear', () => {
    const { html } = issueEmail('Hola', '<script>x</script>\n\nMirá https://laforja.dev/rutas.', 'https://u');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://laforja.dev/rutas" ');
  });
});

describe('POST /api/newsletter/subscribe', () => {
  test('alta nueva: 202, queda pending y manda el mail de confirmación', async () => {
    const res = await subscribe('Nueva@Example.com');
    expect(res.status).toBe(202);
    expect((await row('nueva@example.com'))?.status).toBe('pending');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('nueva@example.com');
    expect(mailer.sent[0]!.text).toContain('http://localhost:3000/newsletter/confirmar?token=');
  });

  test('pendiente que vuelve a anotarse: reenvía con el mismo token', async () => {
    await subscribe('repite@example.com');
    const first = tokenFromMail();
    await subscribe('repite@example.com');
    expect(tokenFromMail()).toBe(first);
    expect(mailer.sent).toHaveLength(2);
  });

  test('ya confirmado: misma respuesta y no manda nada', async () => {
    const { email } = await confirmed();
    mailer.reset();
    const res = await subscribe(email);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0);
  });

  test('dado de baja que vuelve: pending con token nuevo', async () => {
    const { email, token } = await confirmed();
    await req('POST', '/api/newsletter/unsubscribe', { token });
    await subscribe(email);
    const r = await row(email);
    expect(r?.status).toBe('pending');
    expect(r?.token).not.toBe(token);
    // El link viejo ya no confirma.
    expect((await req('POST', '/api/newsletter/confirm', { token })).status).toBe(404);
  });

  test('email inválido: 400', async () => {
    expect((await subscribe('nada')).status).toBe(400);
  });

  test('rate limit por IP', async () => {
    const { app: limited } = await createTestApp({ newsletter: { limit: 2, windowMs: 60_000 } });
    const hit = (ip: string, n: number) =>
      limited.request('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ email: `rl${n}@example.com` }),
      });
    expect((await hit('1.1.1.1', 1)).status).toBe(202);
    expect((await hit('1.1.1.1', 2)).status).toBe(202);
    expect((await hit('1.1.1.1', 3)).status).toBe(429);
    expect((await hit('2.2.2.2', 4)).status).toBe(202);
  });

  test('sin mailer: 503 y status apagado', async () => {
    const { app: off } = await createTestApp(undefined, undefined, null);
    const res = await off.request('/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com' }),
    });
    expect(res.status).toBe(503);
    expect(await (await off.request('/api/newsletter/status')).json()).toEqual({ enabled: false });
  });

  test('si Resend falla: 502 mailer_error', async () => {
    mailer.failOnBatch = 1;
    const res = await subscribe('falla@example.com');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'mailer_error' });
  });
});

describe('confirmar y darse de baja', () => {
  test('confirmar: 200 con el email; token desconocido o mal formado: 404', async () => {
    await subscribe('conf@example.com');
    const token = tokenFromMail();
    const res = await req('POST', '/api/newsletter/confirm', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: 'conf@example.com' });
    expect((await row('conf@example.com'))?.status).toBe('confirmed');
    expect((await req('POST', '/api/newsletter/confirm', { token: 'a'.repeat(64) })).status).toBe(404);
    expect((await req('POST', '/api/newsletter/confirm', { token: 'corto' })).status).toBe(404);
  });

  test('baja por la página', async () => {
    const { email, token } = await confirmed();
    expect((await req('POST', '/api/newsletter/unsubscribe', { token })).status).toBe(200);
    expect((await row(email))?.status).toBe('unsubscribed');
  });

  test('baja en un click (RFC 8058)', async () => {
    const { email, token } = await confirmed();
    const res = await app.request(`/api/newsletter/unsubscribe/one-click?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect((await row(email))?.status).toBe('unsubscribed');
    expect((await app.request('/api/newsletter/unsubscribe/one-click?token=zzz', { method: 'POST' })).status).toBe(404);
  });
});

describe('/api/admin/newsletter', () => {
  const admin = () => makeToken({ sub: 'google-admin-nl', email: TEST_ADMIN_EMAIL, name: 'Admin' });
  const adminReq = async (method: string, path: string, json?: unknown) =>
    req(method, path, json, { Authorization: `Bearer ${await admin()}` });

  test('no admin: 404', async () => {
    const token = await makeToken({ sub: 'google-nl-user', email: 'nl-user@example.com' });
    const res = await req('GET', '/api/admin/newsletter', undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
  });

  test('prueba: va solo al admin y no queda en el historial', async () => {
    await confirmed();
    mailer.reset();
    const res = await adminReq('POST', '/api/admin/newsletter/issues', { subject: 'Hola', body: 'Texto', test: true });
    expect(res.status).toBe(200);
    expect(mailer.sent.map((m) => m.to)).toEqual([TEST_ADMIN_EMAIL]);
    expect(mailer.sent[0]!.subject).toBe('[Prueba] Hola');
    expect(await db.select().from(newsletterIssues)).toHaveLength(0);
  });

  test('envío real: solo a confirmados, con List-Unsubscribe propio, y queda registrado', async () => {
    const a = await confirmed();
    await subscribe('pendiente-nl@example.com');
    const gone = await confirmed();
    await req('POST', '/api/newsletter/unsubscribe', { token: gone.token });
    mailer.reset();

    const res = await adminReq('POST', '/api/admin/newsletter/issues', { subject: 'Número 1', body: 'Hola lectores' });
    expect(res.status).toBe(200);
    const recipients = mailer.sent.map((m) => m.to);
    expect(recipients).toContain(a.email);
    expect(recipients).not.toContain('pendiente-nl@example.com');
    expect(recipients).not.toContain(gone.email);

    const toA = mailer.sent.find((m) => m.to === a.email)!;
    expect(toA.headers?.['List-Unsubscribe']).toBe(
      `<http://localhost:3000/api/newsletter/unsubscribe/one-click?token=${a.token}>`,
    );
    expect(toA.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(toA.text).toContain(`/newsletter/baja?token=${a.token}`);

    const body = (await (await adminReq('GET', '/api/admin/newsletter')).json()) as {
      enabled: boolean;
      counts: Record<string, number>;
      issues: { subject: string; recipientCount: number }[];
    };
    expect(body.enabled).toBe(true);
    expect(body.issues[0]).toMatchObject({ subject: 'Número 1', recipientCount: recipients.length });
    expect(body.counts.unsubscribed).toBeGreaterThanOrEqual(1);
  });

  test('corte de Resend a mitad: 502, registra solo lo que salió', async () => {
    await db.delete(newsletterIssues);
    for (let i = 0; i < 101; i++) {
      await db.insert(newsletterSubscribers).values({
        email: `masivo${i}@example.com`,
        status: 'confirmed',
        token: `${i}`.padStart(64, 'b'),
      });
    }
    mailer.reset();
    mailer.failOnBatch = 2;
    const res = await adminReq('POST', '/api/admin/newsletter/issues', { subject: 'Grande', body: 'x' });
    expect(res.status).toBe(502);
    const out = (await res.json()) as { sent: number; total: number };
    expect(out.sent).toBe(100);
    expect(out.total).toBeGreaterThan(100);
    const [issue] = await db.select().from(newsletterIssues);
    expect(issue?.recipientCount).toBe(100);
  });

  test('input inválido: 400 con el campo', async () => {
    const res = await adminReq('POST', '/api/admin/newsletter/issues', { subject: '', body: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input', field: 'subject' });
  });
});

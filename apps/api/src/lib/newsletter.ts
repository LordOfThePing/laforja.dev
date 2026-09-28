import { randomBytes } from 'node:crypto';

export const MAX_SUBJECT_LENGTH = 150;
export const MAX_BODY_LENGTH = 20_000;

// Lo justo para rechazar basura evidente; la validación real es que el mail de confirmación llegue.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = (body as Record<string, unknown>).email;
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

export function parseToken(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const token = (body as Record<string, unknown>).token;
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export function isToken(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{64}$/.test(value);
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export type IssueInput = { subject: string; body: string; test: boolean };

export function parseIssueInput(body: unknown): IssueInput | { error: string; field: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_input', field: 'body' };
  const b = body as Record<string, unknown>;
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const text = typeof b.body === 'string' ? b.body.replace(/\r\n?/g, '\n').trim() : '';
  if (subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) return { error: 'invalid_input', field: 'subject' };
  if (text.length === 0 || text.length > MAX_BODY_LENGTH) return { error: 'invalid_input', field: 'body' };
  return { subject, body: text, test: b.test === true };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Se escapa primero y después se linkea, así una URL no puede meter HTML.
function paragraphsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => {
      const linked = escapeHtml(p).replace(
        /https?:\/\/[^\s<]+[^\s<.,;:!?)]/g,
        (url) => `<a href="${url}" style="color:#c2410c">${url}</a>`,
      );
      return `<p style="margin:0 0 16px">${linked.replaceAll('\n', '<br>')}</p>`;
    })
    .join('');
}

function layout(title: string, inner: string, footer: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f1ea">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#1c1917">
<div style="font-family:Georgia,serif;font-size:22px;margin-bottom:24px">La Forja</div>
${inner}
<hr style="border:0;border-top:1px solid #e7e0d6;margin:32px 0 16px">
<div style="font-size:12px;color:#78716c">${footer}</div>
</div></body></html>`;
}

export function confirmationEmail(confirmUrl: string) {
  const subject = 'Confirmá tu suscripción al newsletter de La Forja';
  const html = layout(
    subject,
    `<p style="margin:0 0 16px">Recibimos un pedido para sumar esta dirección al newsletter de La Forja: herramientas nuevas, cursos y lo que vamos aprendiendo trabajando con agentes.</p>
<p style="margin:0 0 24px"><a href="${confirmUrl}" style="display:inline-block;background:#ff7a00;color:#1a0e00;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Confirmar suscripción</a></p>`,
    'Si no fuiste vos, ignorá este mail: sin confirmar no te vamos a mandar nada.',
  );
  const text = `Recibimos un pedido para sumar esta dirección al newsletter de La Forja.\n\nConfirmá acá: ${confirmUrl}\n\nSi no fuiste vos, ignorá este mail: sin confirmar no te vamos a mandar nada.`;
  return { subject, html, text };
}

export function issueEmail(subject: string, body: string, unsubscribeUrl: string) {
  const html = layout(
    subject,
    paragraphsHtml(body),
    `Te llega porque te suscribiste al newsletter de La Forja. <a href="${unsubscribeUrl}" style="color:#78716c">Darme de baja</a>.`,
  );
  const text = `${body}\n\n—\nTe llega porque te suscribiste al newsletter de La Forja.\nDarte de baja: ${unsubscribeUrl}`;
  return { html, text };
}

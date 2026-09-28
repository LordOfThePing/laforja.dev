const RESEND_API = 'https://api.resend.com';
// Tope de Resend para /emails/batch.
export const BATCH_SIZE = 100;

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export interface Mailer {
  // Todo o nada por lote: si Resend rechaza el lote, no salió ninguno de ese lote.
  sendBatch(emails: Email[]): Promise<void>;
}

export class MailerError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Resend respondió ${status}: ${body}`);
  }
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async sendBatch(emails) {
      if (emails.length === 0) return;
      if (emails.length > BATCH_SIZE) throw new Error(`lote de ${emails.length}: el máximo es ${BATCH_SIZE}`);
      const res = await fetch(`${RESEND_API}/emails/batch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emails.map((e) => ({ from, ...e }))),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new MailerError(res.status, await res.text());
    },
  };
}

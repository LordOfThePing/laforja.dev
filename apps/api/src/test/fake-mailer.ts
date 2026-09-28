import { type Email, type Mailer, MailerError } from '../lib/mailer.ts';

export class FakeMailer implements Mailer {
  sent: Email[] = [];
  batches = 0;
  // Número de lote (1-based) que falla, para simular un corte a mitad de envío.
  failOnBatch: number | null = null;

  async sendBatch(emails: Email[]) {
    this.batches += 1;
    if (this.failOnBatch === this.batches) throw new MailerError(500, 'falla simulada');
    this.sent.push(...emails);
  }

  reset() {
    this.sent = [];
    this.batches = 0;
    this.failOnBatch = null;
  }
}

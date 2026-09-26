import type {
  AuthorizedPayment,
  CreatePreapprovalInput,
  MercadoPago,
  Preapproval,
  PreapprovalStatus,
} from '../lib/mercadopago.ts';
import { MercadoPagoError } from '../lib/mercadopago.ts';

export class FakeMercadoPago implements MercadoPago {
  preapprovals = new Map<string, Preapproval>();
  authorizedPayments = new Map<string, AuthorizedPayment>();
  created: CreatePreapprovalInput[] = [];
  cancelled: string[] = [];
  failNext = false;
  private seq = 0;

  private guard() {
    if (this.failNext) {
      this.failNext = false;
      throw new MercadoPagoError(500, 'falla simulada');
    }
  }

  async createPreapproval(input: CreatePreapprovalInput) {
    this.guard();
    this.seq += 1;
    const id = `pre-${this.seq}`;
    const pre = {
      id,
      status: 'pending' as const,
      external_reference: input.externalReference,
      next_payment_date: null,
      init_point: `https://mp.test/checkout/${id}`,
    };
    this.created.push(input);
    this.preapprovals.set(id, pre);
    return pre;
  }

  async getPreapproval(id: string) {
    this.guard();
    const pre = this.preapprovals.get(id);
    if (!pre) throw new MercadoPagoError(404, 'not found');
    return pre;
  }

  async cancelPreapproval(id: string) {
    this.guard();
    const pre = await this.getPreapproval(id);
    pre.status = 'cancelled';
    this.cancelled.push(id);
    return pre;
  }

  async getAuthorizedPayment(id: string) {
    this.guard();
    const payment = this.authorizedPayments.get(id);
    if (!payment) throw new MercadoPagoError(404, 'not found');
    return payment;
  }

  async searchPreapprovals({ status, offset, limit }: { status: PreapprovalStatus; offset: number; limit: number }) {
    this.guard();
    const all = [...this.preapprovals.values()].filter((p) => p.status === status);
    return { results: all.slice(offset, offset + limit), paging: { offset, limit, total: all.length } };
  }
}

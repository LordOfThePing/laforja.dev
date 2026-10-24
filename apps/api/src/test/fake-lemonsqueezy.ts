import type { CreateCheckoutInput, LemonSqueezy, LemonSubscription } from '../lib/lemonsqueezy.ts';
import { LemonSqueezyError } from '../lib/lemonsqueezy.ts';

export const TEST_LS_VARIANTS = { basic: '1001', pro: '1002' };

export class FakeLemonSqueezy implements LemonSqueezy {
  checkouts: (CreateCheckoutInput & { id: string })[] = [];
  subscriptions = new Map<string, LemonSubscription>();
  cancelled: string[] = [];
  failNext = false;
  private seq = 0;

  private guard() {
    if (this.failNext) {
      this.failNext = false;
      throw new LemonSqueezyError(500, 'falla simulada');
    }
  }

  async createCheckout(input: CreateCheckoutInput) {
    this.guard();
    const id = `chk-${++this.seq}`;
    this.checkouts.push({ ...input, id });
    return { id, url: `https://laforja.lemonsqueezy.test/checkout/custom/${id}` };
  }

  // Simula que el usuario pagó: LS crea la suscripción con la variant del checkout.
  complete(checkoutId: string, renewsAt = '2099-01-01T00:00:00.000Z'): LemonSubscription {
    const checkout = this.checkouts.find((c) => c.id === checkoutId);
    if (!checkout) throw new Error('checkout inexistente');
    const sub: LemonSubscription = {
      id: String(5000 + ++this.seq),
      status: 'active',
      customerId: String(9000 + this.seq),
      variantId: checkout.variantId,
      userEmail: checkout.email,
      renewsAt,
      endsAt: null,
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async getSubscription(id: string) {
    this.guard();
    const sub = this.subscriptions.get(id);
    if (!sub) throw new LemonSqueezyError(404, 'not found');
    return { ...sub };
  }

  async cancelSubscription(id: string) {
    this.guard();
    const sub = this.subscriptions.get(id);
    if (!sub) throw new LemonSqueezyError(404, 'not found');
    sub.status = 'cancelled';
    sub.endsAt = sub.renewsAt;
    this.cancelled.push(id);
    return { ...sub };
  }

  async listActiveSubscriptions({ page, size }: { page: number; size: number }) {
    this.guard();
    const all = [...this.subscriptions.values()].filter((s) => s.status === 'active');
    const lastPage = Math.max(1, Math.ceil(all.length / size));
    return { data: all.slice((page - 1) * size, page * size), lastPage };
  }
}

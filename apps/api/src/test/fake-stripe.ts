import type {
  CreateCheckoutInput,
  Stripe,
  StripeCheckoutSession,
  StripeCustomer,
  StripeSubscription,
} from '../lib/stripe.ts';
import { StripeError } from '../lib/stripe.ts';

export class FakeStripe implements Stripe {
  customers: StripeCustomer[] = [];
  sessions = new Map<string, StripeCheckoutSession>();
  subscriptions = new Map<string, StripeSubscription>();
  checkouts: CreateCheckoutInput[] = [];
  failNext = false;
  private seq = 0;

  private guard() {
    if (this.failNext) {
      this.failNext = false;
      throw new StripeError(500, 'falla simulada');
    }
  }

  async createCustomer(email: string) {
    this.guard();
    const customer = { id: `cus_${++this.seq}`, email };
    this.customers.push(customer);
    return customer;
  }

  async createCheckoutSession(input: CreateCheckoutInput) {
    this.guard();
    const id = `cs_${++this.seq}`;
    const session = {
      id,
      url: `https://stripe.test/checkout/${id}`,
      customer: input.customerId ?? null,
      subscription: null,
      metadata: { user_id: input.userId, plan: input.plan },
    };
    this.checkouts.push(input);
    this.sessions.set(id, session);
    return session;
  }

  // Simula que el usuario pagó en Checkout: Stripe crea la subscription con la metadata de la session.
  complete(sessionId: string, currentPeriodEnd = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000)) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session inexistente');
    const sub: StripeSubscription = {
      id: `sub_${++this.seq}`,
      status: 'active',
      customer: session.customer ?? 'cus_x',
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: false,
      canceled_at: null,
      items: { data: [{ price: { id: `price_inline_${this.seq}` } }] },
      metadata: { ...(session.metadata ?? {}) },
    };
    session.subscription = sub.id;
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async getCheckoutSession(id: string) {
    this.guard();
    const session = this.sessions.get(id);
    if (!session) throw new StripeError(404, 'not found');
    return session;
  }

  async getSubscription(id: string) {
    this.guard();
    const sub = this.subscriptions.get(id);
    if (!sub) throw new StripeError(404, 'not found');
    return sub;
  }

  async cancelSubscription(id: string) {
    this.guard();
    const sub = await this.getSubscription(id);
    sub.cancel_at_period_end = true;
    return sub;
  }

  async listActiveSubscriptions({ startingAfter, limit }: { startingAfter?: string; limit: number }) {
    this.guard();
    const all = [...this.subscriptions.values()].filter((s) => s.status === 'active');
    const from = startingAfter ? all.findIndex((s) => s.id === startingAfter) + 1 : 0;
    const data = all.slice(from, from + limit);
    return { data, has_more: from + limit < all.length };
  }
}

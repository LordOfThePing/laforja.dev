const MP_API = 'https://api.mercadopago.com';

export type PreapprovalStatus = 'pending' | 'authorized' | 'paused' | 'cancelled';

export type Preapproval = {
  id: string;
  status: PreapprovalStatus;
  external_reference: string | null;
  next_payment_date: string | null;
  init_point?: string;
};

export type AuthorizedPayment = {
  id: number | string;
  preapproval_id: string;
  status: string;
  payment: { id: number | string; status: string } | null;
};

export type PreapprovalSearch = {
  results: Preapproval[];
  paging: { offset: number; limit: number; total: number };
};

export type CreatePreapprovalInput = {
  reason: string;
  amount: number;
  payerEmail: string;
  externalReference: string;
  backUrl: string;
};

export interface MercadoPago {
  createPreapproval(input: CreatePreapprovalInput): Promise<Preapproval & { init_point: string }>;
  getPreapproval(id: string): Promise<Preapproval>;
  cancelPreapproval(id: string): Promise<Preapproval>;
  getAuthorizedPayment(id: string): Promise<AuthorizedPayment>;
  searchPreapprovals(query: { status: PreapprovalStatus; offset: number; limit: number }): Promise<PreapprovalSearch>;
}

export class MercadoPagoError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`MercadoPago respondió ${status}: ${body}`);
  }
}

export function createMercadoPago(accessToken: string): MercadoPago {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${MP_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new MercadoPagoError(res.status, await res.text());
    return (await res.json()) as T;
  }

  return {
    createPreapproval: (input) =>
      call('POST', '/preapproval', {
        reason: input.reason,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: input.amount,
          currency_id: 'ARS',
        },
        back_url: input.backUrl,
        payer_email: input.payerEmail,
        external_reference: input.externalReference,
        // Sin card_token_id, MP deja la suscripción pendiente y devuelve init_point para pagar.
        status: 'pending',
      }),
    getPreapproval: (id) => call('GET', `/preapproval/${encodeURIComponent(id)}`),
    cancelPreapproval: (id) =>
      call('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' }),
    getAuthorizedPayment: (id) => call('GET', `/authorized_payments/${encodeURIComponent(id)}`),
    searchPreapprovals: ({ status, offset, limit }) =>
      call('GET', `/preapproval/search?${new URLSearchParams({ status, offset: String(offset), limit: String(limit) })}`),
  };
}

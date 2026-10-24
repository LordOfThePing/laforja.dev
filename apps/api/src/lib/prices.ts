import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { planPrices } from '../db/schema.ts';
import type { PaymentProvider, Plan } from '../routes/subscription.ts';

export type Currency = 'ARS' | 'USD';

// Montos en centavos.
export type PriceTable = Record<Plan, Record<Currency, number>>;

export const PROVIDER_CURRENCY: Record<PaymentProvider, Currency> = {
  mercadopago: 'ARS',
  lemonsqueezy: 'USD',
};

const PLANS: readonly Plan[] = ['basic', 'pro'];
const CURRENCIES: readonly Currency[] = ['ARS', 'USD'];

// Tope de cordura: un typo de un cero de más en el panel no tiene que salir a cobrar.
const MAX_AMOUNT = 100_000_000;

export async function loadPrices(db: Db): Promise<PriceTable> {
  const rows = await db.select().from(planPrices);
  const table = {} as PriceTable;
  for (const plan of PLANS) {
    const byCurrency = {} as Record<Currency, number>;
    for (const currency of CURRENCIES) {
      const row = rows.find((r) => r.plan === plan && r.currency === currency);
      // La migración 0011 carga las cuatro filas y el panel no permite borrarlas.
      if (!row) throw new Error(`Falta el precio ${plan}/${currency} en plan_prices`);
      byCurrency[currency] = row.amount;
    }
    table[plan] = byCurrency;
  }
  return table;
}

export type PriceInput = { plan: Plan; currency: Currency; amount: number };

export function parsePrices(raw: unknown): PriceInput[] | null {
  const list = (raw as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(list) || list.length === 0) return null;
  const parsed: PriceInput[] = [];
  for (const item of list) {
    const { plan, currency, amount } = (item ?? {}) as Record<string, unknown>;
    if (!PLANS.includes(plan as Plan) || !CURRENCIES.includes(currency as Currency)) return null;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
    parsed.push({ plan: plan as Plan, currency: currency as Currency, amount });
  }
  return parsed;
}

export async function savePrices(db: Db, prices: PriceInput[]): Promise<void> {
  await db
    .insert(planPrices)
    .values(prices.map((p) => ({ ...p, updatedAt: new Date() })))
    .onConflictDoUpdate({
      target: [planPrices.plan, planPrices.currency],
      set: { amount: sql`excluded.amount`, updatedAt: sql`excluded.updated_at` },
    });
}

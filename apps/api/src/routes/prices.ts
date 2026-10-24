import { Hono } from 'hono';
import type { Db } from '../db/client.ts';
import { loadPrices } from '../lib/prices.ts';

// Público: la home y /suscripcion muestran los montos sin sesión.
export function pricesRoutes(db: Db, { stripeEnabled }: { stripeEnabled: boolean }) {
  const app = new Hono();
  app.get('/', async (c) => {
    const prices = await loadPrices(db);
    return c.json({ prices, providers: { mercadopago: true, stripe: stripeEnabled } });
  });
  return app;
}

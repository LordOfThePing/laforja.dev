import { createDb } from '../db/client.ts';
import { env } from '../env.ts';
import { createMercadoPago } from '../lib/mercadopago.ts';
import { createStripe } from '../lib/stripe.ts';
import { reconcileStripeSubscriptions, reconcileSubscriptions } from '../reconcile.ts';

const dryRun = process.argv.includes('--dry-run');
const verb = dryRun ? 'a corregir (dry run, no se escribió nada)' : 'corregidas';
const { db, close } = createDb(env.databaseUrl);
try {
  const { checked, changes } = await reconcileSubscriptions(db, createMercadoPago(env.mpAccessToken), { dryRun });
  console.log(`MP: ${checked} suscripciones revisadas, ${changes.length} ${verb}`);
  for (const c of changes) {
    console.log(`- usuario ${c.userId} (${c.preapprovalId}):`, c.before, '→', c.after);
  }
  if (env.stripeSecretKey) {
    const stripe = await reconcileStripeSubscriptions(db, createStripe(env.stripeSecretKey), { dryRun });
    console.log(`Stripe: ${stripe.checked} suscripciones revisadas, ${stripe.changes.length} ${verb}`);
    for (const c of stripe.changes) {
      console.log(`- usuario ${c.userId} (${c.subscriptionId}):`, c.before, '→', c.after);
    }
  }
} finally {
  await close();
}

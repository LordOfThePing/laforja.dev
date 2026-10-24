import { createDb } from '../db/client.ts';
import { env } from '../env.ts';
import { createLemonSqueezy } from '../lib/lemonsqueezy.ts';
import { variantPlans } from '../lib/lemonsqueezy-sync.ts';
import { createMercadoPago } from '../lib/mercadopago.ts';
import { reconcileLemonSubscriptions, reconcileSubscriptions } from '../reconcile.ts';

const dryRun = process.argv.includes('--dry-run');
const verb = dryRun ? 'a corregir (dry run, no se escribió nada)' : 'corregidas';
const { db, close } = createDb(env.databaseUrl);
try {
  const { checked, changes } = await reconcileSubscriptions(db, createMercadoPago(env.mpAccessToken), { dryRun });
  console.log(`MP: ${checked} suscripciones revisadas, ${changes.length} ${verb}`);
  for (const c of changes) {
    console.log(`- usuario ${c.userId} (${c.preapprovalId}):`, c.before, '→', c.after);
  }
  if (env.lemon) {
    const client = createLemonSqueezy({ apiKey: env.lemon.apiKey, storeId: env.lemon.storeId });
    const ls = await reconcileLemonSubscriptions(db, client, variantPlans(env.lemon.variants), { dryRun });
    console.log(`Lemon Squeezy: ${ls.checked} suscripciones revisadas, ${ls.changes.length} ${verb}`);
    for (const c of ls.changes) {
      console.log(`- usuario ${c.userId} (${c.subscriptionId}):`, c.before, '→', c.after);
    }
  }
} finally {
  await close();
}

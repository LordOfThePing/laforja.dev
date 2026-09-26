import { createDb } from '../db/client.ts';
import { env } from '../env.ts';
import { createMercadoPago } from '../lib/mercadopago.ts';
import { reconcileSubscriptions } from '../reconcile.ts';

const dryRun = process.argv.includes('--dry-run');
const { db, close } = createDb(env.databaseUrl);
try {
  const { checked, changes } = await reconcileSubscriptions(db, createMercadoPago(env.mpAccessToken), { dryRun });
  console.log(`${checked} suscripciones revisadas, ${changes.length} ${dryRun ? 'a corregir (dry run, no se escribió nada)' : 'corregidas'}`);
  for (const c of changes) {
    console.log(`- usuario ${c.userId} (${c.preapprovalId}):`, c.before, '→', c.after);
  }
} finally {
  await close();
}

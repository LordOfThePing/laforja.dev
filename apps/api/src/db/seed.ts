import { env } from '../env.ts';
import { createDb } from './client.ts';
import { seed } from './seed-data.ts';

const { db, close } = createDb(env.databaseUrl);
await seed(db);
await close();
console.log('Seed aplicado.');

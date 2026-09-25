import { createDb } from './client.ts';
import { seed } from './seed-data.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');

const { db, close } = createDb(url);
await seed(db);
await close();
console.log('Seed aplicado.');

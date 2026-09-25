import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Aplica las migraciones generadas en ./drizzle con drizzle-orm, sin drizzle-kit: así la
// imagen de producción no necesita dependencias de desarrollo.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');

const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
await sql.end();
console.log('Migraciones aplicadas.');

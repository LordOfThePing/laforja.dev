import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

// Tipo común a postgres-js (runtime) y PGlite (tests), para que las rutas no dependan del driver.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  const sql = postgres(url);
  return { db: drizzle(sql, { schema }) as Db, close: () => sql.end() };
}

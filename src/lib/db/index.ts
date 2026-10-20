import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** Works with the production driver (postgres.js) and with PGlite in tests. */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { wishlistDb?: DB; wishlistSql?: postgres.Sql };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL n’est pas défini (voir .env.example)');
  return url;
}

/** One connection pool per process, kept across hot reloads in development. */
export function getDb(): DB {
  if (!globalForDb.wishlistDb) {
    globalForDb.wishlistSql = postgres(databaseUrl(), { max: 10, onnotice: () => {} });
    globalForDb.wishlistDb = drizzle(globalForDb.wishlistSql, { schema }) as unknown as DB;
  }
  return globalForDb.wishlistDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.wishlistSql?.end({ timeout: 5 });
  globalForDb.wishlistSql = undefined;
  globalForDb.wishlistDb = undefined;
}

export { schema };

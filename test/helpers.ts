// A real PostgreSQL (PGlite, compiled to WebAssembly) per test file, migrated
// with the same SQL files as production. No server, no Docker.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { DB } from '../src/lib/db/index.ts';
import * as schema from '../src/lib/db/schema.ts';

export async function createTestDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  return { db: db as unknown as DB, close: () => client.close() };
}

export const utc = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

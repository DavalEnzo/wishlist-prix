// Applies the SQL migrations in ./drizzle. Run before the site and the worker start.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { databaseUrl } from '../lib/db/index.ts';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// The database container may still be starting: retry for about a minute.
let sql: postgres.Sql | null = null;
for (let attempt = 1; ; attempt++) {
  try {
    sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
    await sql`select 1`;
    break;
  } catch (e) {
    await sql?.end({ timeout: 1 }).catch(() => {});
    if (attempt >= 30) throw e;
    console.log(`Base de données pas encore prête (${attempt}/30)…`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log('Base de données à jour.');
} finally {
  await sql.end({ timeout: 5 });
}

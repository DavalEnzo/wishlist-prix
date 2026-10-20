// Prints a one-time password reset link for an account, valid one hour.
// Usage: docker compose exec web npm run reset-password -- email@exemple.fr
import { eq } from 'drizzle-orm';
import { createResetForUser } from '../lib/auth/accounts.ts';
import { config } from '../lib/config.ts';
import { closeDb, getDb } from '../lib/db/index.ts';
import { users } from '../lib/db/schema.ts';
import { normalizeEmail } from '../lib/validate.ts';

const email = process.argv[2];
if (!email) {
  console.error('Usage : npm run reset-password -- email@exemple.fr');
  process.exit(1);
}

const db = getDb();
try {
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  if (!user) {
    console.error(`Aucun compte avec l’adresse ${email}.`);
    process.exitCode = 1;
  } else {
    const token = await createResetForUser(db, user.id);
    console.log(`Lien de réinitialisation pour ${user.name} (valable une heure) :\n${config.appUrl}/reset/${token}`);
  }
} finally {
  await closeDb();
}

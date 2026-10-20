import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.ts';
import { WishlistError } from './wishlist.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

try {
  const { failed } = await run({ root, dryRun, webhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined });
  if (failed) {
    console.error('Aucun prix n’a pu être relevé. AllKeyShop est peut-être indisponible ou a changé son API.');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof WishlistError ? e.message : `Échec du relevé : ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
}

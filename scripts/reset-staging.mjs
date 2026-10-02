// Drops EVERY table in the STAGING D1 database (including d1_migrations) so the
// reset-staging workflow can re-apply migrations from scratch. Refuses to run
// unless D1_DATABASE_ID is set and is not the production database id.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID (staging).
// Usage: D1_DATABASE_ID=<staging id> node scripts/reset-staging.mjs [--dry-run]
import { assertStagingDatabase, d1 } from './d1-rest.mjs';

try {
  assertStagingDatabase(process.env.D1_DATABASE_ID);
  const dryRun = process.argv.includes('--dry-run');
  const rows = await d1(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`,
  );
  const names = rows.map((row) => row.name).filter((name) => /^[A-Za-z0-9_]+$/.test(name));
  console.log(`Tables to drop (${names.length}): ${names.join(', ') || 'none'}`);
  if (!dryRun) {
    // Foreign-key enforcement is off by default over the D1 REST API; drop in any order.
    for (const name of names) await d1(`DROP TABLE IF EXISTS "${name}"`);
    console.log('Dropped.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

// Adds to the STAGING database only what its real scrapers cannot fill for the test world (lib/test-seed): the fund
// directory, fund prices and payouts (MUFAP blocks GitHub's runners) and the super_admin role of the fictional test
// account. Everything is INSERT OR IGNORE except that one role row, so real scraped rows are never overwritten.
// Refuses to run unless D1_DATABASE_ID is set and is not the production database.
//
// Usage (CI, after a deploy): D1_DATABASE_ID=<staging id> node scripts/seed-staging-public.mjs [--dry-run]
import { pathToFileURL } from 'node:url';
import { assertStagingDatabase } from './d1-rest.mjs';
import { buildPublicFixtureSql } from '../lib/test-seed/public-fixtures.ts';

const CHUNK = 40;
const pktToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Sends the gap-filling statements in small multi-statement batches through `run` (the D1 REST helper). */
export async function seedStagingPublic(run, today = pktToday(), now = new Date()) {
  const statements = buildPublicFixtureSql(today, 'gaps', now);
  for (let i = 0; i < statements.length; i += CHUNK) await run(statements.slice(i, i + CHUNK).join('\n'));
  return statements.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--dry-run')) {
    console.log(buildPublicFixtureSql(pktToday(), 'gaps').join('\n'));
  } else {
    const id = assertStagingDatabase();
    // d1-rest reads D1_DATABASE_ID at import time, so import it only after the guard passed.
    const { d1 } = await import('./d1-rest.mjs');
    const count = await seedStagingPublic((sql) => d1(sql));
    console.log(`Seeded ${count} gap-filling rows into staging database ${id.slice(0, 8)}…`);
  }
}

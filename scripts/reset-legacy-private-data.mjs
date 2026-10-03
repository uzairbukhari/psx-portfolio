// One-time cutover tool: removes the plaintext private data the pre-encryption app stored in the main D1 database.
// DRY-RUN BY DEFAULT. It prints per-category row counts only, never a row, an email, a ticker or an amount.
//
// It clears: portfolios (plaintext ledgers), ai_reviews, monthly_recommendations + recommendation_attempts, and
// research_jobs + research_events. It keeps: every public table (quotes, company facts, price history, directory,
// face values, IPO offers, dividend announcements), user_roles, rate limits, ai_usage (cost counters only) and
// migrations. `--revoke-sessions` also deletes mobile_sessions (signs every phone out, drops push tokens).
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID (required, never defaulted).
// Usage:
//   D1_DATABASE_ID=<id> node scripts/reset-legacy-private-data.mjs --target=staging|production            (dry run)
//   D1_DATABASE_ID=<id> node scripts/reset-legacy-private-data.mjs --target=production --execute --confirm=<first 8 chars of the id>
// Read docs/private-portfolio-release-runbook.md before executing against production.
import { PROD_DATABASE_ID } from './d1-rest.mjs';

/** Delete order matters only for readability: foreign keys are not enforced over the D1 REST API. */
export const RESET_TABLES = [
  { name: 'recommendation_attempts', category: 'Monthly Picks attempts' },
  { name: 'monthly_recommendations', category: 'Monthly Picks runs' },
  { name: 'ai_reviews', category: 'AI reviews' },
  { name: 'research_events', category: 'Research events' },
  { name: 'research_jobs', category: 'Research jobs' },
  { name: 'portfolios', category: 'Plaintext portfolios' },
];
export const SESSION_TABLE = { name: 'mobile_sessions', category: 'Mobile sessions (revoked)' };

export function parseArgs(argv) {
  const value = (flag) => argv.find((arg) => arg.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  return {
    target: value('target'),
    confirm: value('confirm'),
    execute: argv.includes('--execute'),
    revokeSessions: argv.includes('--revoke-sessions'),
  };
}

/** Throws unless the explicit database id, the named target and (to execute) the confirmation all agree. */
export function checkTarget({ target, execute, confirm }, databaseId, productionId = PROD_DATABASE_ID) {
  const id = (databaseId ?? '').trim().toLowerCase();
  if (!id) throw Error('Refusing to run: set D1_DATABASE_ID to the database you mean to reset. There is no default.');
  if (target !== 'staging' && target !== 'production') throw Error('Refusing to run: pass --target=staging or --target=production.');
  const isProduction = id === productionId.toLowerCase();
  if (target === 'production' && !isProduction) throw Error('Refusing to run: --target=production but D1_DATABASE_ID is not the production database.');
  if (target === 'staging' && isProduction) throw Error('Refusing to run: --target=staging but D1_DATABASE_ID is the production database.');
  if (execute && confirm !== id.slice(0, 8)) throw Error(`Refusing to execute: pass --confirm=${id.slice(0, 8)} (the first 8 characters of the database id).`);
  return { id, isProduction };
}

export const plan = (options) => (options.revokeSessions ? [...RESET_TABLES, SESSION_TABLE] : RESET_TABLES);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { id, isProduction } = checkTarget(options, process.env.D1_DATABASE_ID);
  const { d1 } = await import('./d1-rest.mjs');
  const tables = plan(options);
  console.log(`${options.execute ? 'EXECUTING' : 'DRY RUN'} against the ${isProduction ? 'PRODUCTION' : 'staging'} database ${id.slice(0, 8)}…`);
  for (const table of tables) {
    const [row] = await d1(`SELECT COUNT(*) AS n FROM ${table.name}`).catch(() => [{ n: 'absent' }]);
    console.log(`  ${table.category}: ${row.n} row(s)`);
    if (options.execute && row.n !== 'absent') await d1(`DELETE FROM ${table.name}`);
  }
  console.log(options.execute ? 'Deleted. Public data and admin configuration were not touched.' : 'Nothing was changed. Re-run with --execute and --confirm to delete.');
  if (options.execute && isProduction) console.log('Next: follow the "After deletion" section of docs/private-portfolio-release-runbook.md (Time Travel, copies, provider data).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

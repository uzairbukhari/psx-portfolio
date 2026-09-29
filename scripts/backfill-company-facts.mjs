// One-time data fix: re-fetches every company's name/sector from PSX and overwrites
// the stored value even if one is already set, for every portfolio row in D1. Run
// once after the auto-enrichment feature ships; going forward, new tickers are
// enriched automatically by app/api/portfolio/route.ts and existing ones are left
// alone, so this script should not need to run again.
//
// Usage: node scripts/backfill-company-facts.mjs [--remote]
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchCompanyFacts } from '../lib/company-facts.ts';
import { titleCaseSector } from '../lib/company-enrichment.ts';

const DB_NAME = 'psx-portfolio-sip';
const remote = process.argv.includes('--remote');
const CONCURRENCY = 5;

function d1Command(command) {
  const out = execSync(
    `npx wrangler d1 execute ${DB_NAME} ${remote ? '--remote' : '--local'} --json --command "${command.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out)[0].results;
}

function d1File(sqlPath) {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} ${remote ? '--remote' : '--local'} --file="${sqlPath}"`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'inherit' },
  );
}

async function fetchAllFacts(tickers) {
  const byTicker = new Map();
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const batch = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((t) => fetchCompanyFacts(t)));
    batch.forEach((ticker, j) => {
      const result = results[j];
      if (result.status === 'fulfilled') byTicker.set(ticker, result.value);
      else console.warn(`  ${ticker}: fetch failed — ${result.reason?.message ?? result.reason}`);
    });
  }
  return byTicker;
}

console.log(`Backfilling company names/sectors against ${remote ? 'REMOTE (production)' : 'local'} D1...`);
const rows = d1Command('SELECT user_id, payload, revision FROM portfolios');
console.log(`Found ${rows.length} portfolio row(s).`);

const allTickers = new Set();
const portfolios = rows.map((row) => {
  const portfolio = JSON.parse(row.payload);
  for (const c of portfolio.companies) allTickers.add(c.ticker);
  return { user_id: row.user_id, revision: row.revision, portfolio };
});
console.log(`Fetching PSX facts for ${allTickers.size} distinct ticker(s)...`);
const facts = await fetchAllFacts([...allTickers]);

// Rewriting the whole payload as one SQL string literal can exceed D1 remote's
// per-statement SQL-text length limit (SQLITE_TOOBIG) once a portfolio has many
// companies. json_set() instead patches just the changed fields by array index,
// so statement size depends only on how much actually changed, not portfolio size.
function sqlString(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

const statements = [];
let touchedCompanies = 0;
for (const { user_id, revision, portfolio } of portfolios) {
  const sets = [];
  portfolio.companies.forEach((company, index) => {
    const found = facts.get(company.ticker);
    if (!found) return;
    const sector = titleCaseSector(found.sector);
    if (company.name === found.name && company.sector === sector) return;
    sets.push(`'$.companies[${index}].name', ${sqlString(found.name)}`);
    sets.push(`'$.companies[${index}].sector', ${sqlString(sector)}`);
    touchedCompanies++;
  });
  if (!sets.length) continue;
  const now = new Date().toISOString();
  statements.push(
    `UPDATE portfolios SET payload=json_set(payload, ${sets.join(', ')}), revision=revision+1, updated_at=${sqlString(now)} WHERE user_id=${sqlString(user_id)} AND revision=${revision};`,
  );
}

if (!statements.length) {
  console.log('Nothing to update — every company already matches PSX.');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'psx-backfill-'));
const sqlPath = join(dir, 'backfill.sql');
writeFileSync(sqlPath, statements.join('\n'));
console.log(`Updating ${statements.length} portfolio row(s), ${touchedCompanies} company field(s) touched...`);
d1File(sqlPath);
rmSync(dir, { recursive: true, force: true });
console.log('Done.');

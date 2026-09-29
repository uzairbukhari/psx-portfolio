// Refreshes the shared `company_facts` cache from outside Cloudflare (PSX drops
// Cloudflare egress; see psx-quote-scrape.mjs). Monthly Picks reads these rows
// instead of fetching PSX from the Worker. Tickers = every ticker held in some
// portfolio plus any ticker with an open `facts_requests` row (an on-demand
// dispatch from the Worker), or the `--tickers=A,B` override.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-facts-scrape.mjs [--dry-run] [--tickers=MEBL,LUCK]
import { pathToFileURL } from 'node:url';
import { d1, heldTickers } from './d1-rest.mjs';
import { fetchCompanyFacts } from '../lib/company-facts.ts';

const CONCURRENCY = 3;
const dryRun = process.argv.includes('--dry-run');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));

/** Tickers to scrape: the explicit override, else held tickers plus open on-demand requests. */
async function targetTickers() {
  if (tickerArg) return heldTickers(tickerArg);
  const held = await heldTickers(undefined);
  const requested = await d1(
    'SELECT ticker FROM facts_requests WHERE attempted_at IS NULL OR attempted_at < requested_at',
  ).catch(() => []);
  const valid = (t) => /^[A-Z0-9]{2,12}$/.test(t ?? '');
  return [...new Set([...held, ...requested.map((row) => String(row.ticker).toUpperCase())])].filter(valid);
}

async function save(ticker, facts) {
  const now = new Date().toISOString();
  const day = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  await d1(
    `INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES (?,?,?,?)
     ON CONFLICT(ticker) DO UPDATE SET fetched_on=excluded.fetched_on, payload=excluded.payload, fetched_at=excluded.fetched_at`,
    [ticker, day, JSON.stringify(facts), facts.fetchedAt ?? now],
  );
  await d1(
    `INSERT INTO facts_requests (ticker,requested_at,attempted_at,error) VALUES (?,?,?,NULL)
     ON CONFLICT(ticker) DO UPDATE SET attempted_at=excluded.attempted_at, error=NULL`,
    [ticker, now, now],
  );
}

async function recordFailure(ticker, message) {
  const now = new Date().toISOString();
  await d1(
    `INSERT INTO facts_requests (ticker,requested_at,attempted_at,error) VALUES (?,?,?,?)
     ON CONFLICT(ticker) DO UPDATE SET attempted_at=excluded.attempted_at, error=excluded.error`,
    [ticker, now, now, message.slice(0, 300)],
  );
}

async function main() {
  const tickers = await targetTickers();
  const ok = [];
  const failed = [];
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const batch = tickers.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (ticker) => {
        try {
          const facts = await fetchCompanyFacts(ticker);
          if (!dryRun) await save(ticker, facts);
          ok.push(ticker);
          if (dryRun) console.log(`  ${ticker} ${facts.name} price=${facts.price} pe=${facts.peTtm} quarters=${facts.quarterly.length}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failed.push(`${ticker}: ${message}`);
          if (!dryRun) await recordFailure(ticker, message).catch(() => {});
        }
      }),
    );
  }
  console.log(
    `PSX facts: ${ok.length}/${tickers.length} tickers` + (failed.length ? `. Failed: ${failed.join('; ')}` : '.'),
  );
  if (tickers.length && !ok.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

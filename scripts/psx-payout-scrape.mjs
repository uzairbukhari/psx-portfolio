// Refreshes the shared `dividend_announcements` table from outside Cloudflare
// (PSX drops Cloudflare egress; see psx-quote-scrape.mjs). For every ticker held
// in some portfolio it reads the company Payouts table and upserts each cash,
// bonus and right announcement. Portfolios turn cash rows into dividends.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-payout-scrape.mjs [--dry-run] [--tickers=MEBL,LUCK]
import { pathToFileURL } from 'node:url';
import { d1, heldTickers } from './d1-rest.mjs';
import { fetchPsxPayoutsHtml } from '../lib/psx-fetch.ts';
import { parsePayouts } from '../lib/psx-payouts.ts';

// D1 allows 100 bound parameters per statement; 10 per row.
const ROWS_PER_STATEMENT = 9;
const dryRun = process.argv.includes('--dry-run');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));

async function upsert(rows, fetchedAt) {
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
    await d1(
      `INSERT INTO dividend_announcements
         (ticker,book_closure_start,announced_on,kind,book_closure_end,period,details,percent,per_share_rs,fetched_at)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')}
       ON CONFLICT(ticker,book_closure_start,announced_on,kind) DO UPDATE SET
         book_closure_end=excluded.book_closure_end,
         period=excluded.period, details=excluded.details, percent=excluded.percent,
         per_share_rs=excluded.per_share_rs, fetched_at=excluded.fetched_at`,
      chunk.flatMap((r) => [
        r.ticker, r.bookClosureStart, r.announcedOn, r.kind, r.bookClosureEnd,
        r.period, r.details, r.percent, r.perShareRs, fetchedAt,
      ]),
    );
  }
}

async function main() {
  const tickers = await heldTickers(tickerArg);
  const rows = [];
  const failed = [];
  for (const ticker of tickers) {
    try {
      rows.push(...parsePayouts(await fetchPsxPayoutsHtml(ticker), ticker));
    } catch (error) {
      failed.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(
    `PSX payouts: ${rows.length} announcements for ${tickers.length - failed.length}/${tickers.length} tickers` +
      (failed.length ? `. Failed: ${failed.join('; ')}` : '.'),
  );
  if (dryRun) {
    for (const r of rows.slice(0, 40))
      console.log(`  ${r.ticker} ${r.bookClosureStart} ${r.kind} ${r.percent ?? 'Rs' + r.perShareRs} (${r.details})`);
    return;
  }
  await upsert(rows, new Date().toISOString());
  if (failed.length === tickers.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

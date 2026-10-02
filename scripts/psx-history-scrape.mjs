// Refreshes the shared `price_history` table (company-page chart) from outside
// Cloudflare (PSX drops Cloudflare egress; see psx-quote-scrape.mjs). For every
// ticker held in some portfolio it stores today's intraday ticks (every run) and
// daily closes (when the stored copy is over 12 hours old). Companies keep 420 trading days; the KSE100 index
// row (used by the mobile benchmark) keeps 2,500 (lib/price-history.ts#eodKeep).
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-history-scrape.mjs [--dry-run] [--tickers=MEBL,LUCK]
import { d1, heldTickers } from './d1-rest.mjs';
import { scrapeExitCode } from './scrape-exit.mjs';
import { fetchPsxToken, fetchPsxTimeseries } from '../lib/psx-fetch.ts';
import { eodKeep, parseEod, parseIntraday } from '../lib/price-history.ts';

const EOD_MAX_AGE_MS = 12 * 3_600_000;
const dryRun = process.argv.includes('--dry-run');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));

async function storedAges() {
  if (dryRun) return new Map();
  const rows = await d1('SELECT ticker, eod_fetched_at FROM price_history');
  return new Map(rows.map((r) => [r.ticker, r.eod_fetched_at]));
}

async function main() {
  const tickers = await heldTickers(tickerArg);
  const ages = await storedAges();
  const now = new Date();
  const failed = [];
  let ok = 0;
  // KSE100 rides along for the market-pulse sparkline (needs a token from any company page).
  if (!tickerArg && tickers.length) tickers.push('KSE100');
  for (const ticker of tickers) {
    try {
      const token = await fetchPsxToken(ticker === 'KSE100' ? tickers[0] : ticker);
      const intraday = parseIntraday(await fetchPsxTimeseries(ticker, 'int', token));
      const eodAt = ages.get(ticker);
      const stale = !eodAt || now - new Date(eodAt) > EOD_MAX_AGE_MS;
      const eod = stale
        ? parseEod(await fetchPsxTimeseries(ticker, 'eod', token)).slice(-eodKeep(ticker))
        : null;
      if (dryRun) {
        console.log(`  ${ticker}: ${intraday.length} intraday, ${eod ? eod.length + ' eod' : 'eod fresh'}`);
      } else {
        const stamp = now.toISOString();
        await d1(
          `INSERT INTO price_history (ticker, eod, intraday, eod_fetched_at, intraday_fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(ticker) DO UPDATE SET
             intraday=excluded.intraday, intraday_fetched_at=excluded.intraday_fetched_at,
             eod=CASE WHEN ? THEN excluded.eod ELSE price_history.eod END,
             eod_fetched_at=CASE WHEN ? THEN excluded.eod_fetched_at ELSE price_history.eod_fetched_at END`,
          [ticker, JSON.stringify(eod ?? []), JSON.stringify(intraday), eod ? stamp : null, stamp, eod ? 1 : 0, eod ? 1 : 0],
        );
      }
      ok++;
    } catch (error) {
      failed.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(
    `PSX history: ${ok}/${tickers.length} tickers` + (failed.length ? `. Failed: ${failed.join('; ')}` : '.'),
  );
  process.exitCode = scrapeExitCode(tickers.length, failed.length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

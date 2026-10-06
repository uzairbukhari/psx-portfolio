// Refreshes the shared `price_history` table (company-page chart) from outside
// Cloudflare (PSX drops Cloudflare egress; see psx-quote-scrape.mjs). For every
// tracked ticker it stores today's intraday ticks (every run) and
// daily closes (when the stored copy is over 12 hours old). Companies keep 1,400 trading days (5Y chart); the KSE100 index
// row (used by the mobile benchmark) keeps 2,500 (lib/price-history.ts#eodKeep).
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-history-scrape.mjs [--dry-run] [--tickers=MEBL,LUCK] [--refresh-eod]
// --refresh-eod re-fetches daily closes for every ticker regardless of age (backfill after raising the retention).
import { d1, trackedTickers } from './d1-rest.mjs';
import { scrapeExitCode } from './scrape-exit.mjs';
import { fetchPsxToken, fetchPsxTimeseries } from '../lib/psx-fetch.ts';
import { eodKeep, parseEod, parseIntraday } from '../lib/price-history.ts';

const EOD_MAX_AGE_MS = 12 * 3_600_000;
const dryRun = process.argv.includes('--dry-run');
const refreshEod = process.argv.includes('--refresh-eod');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));

async function storedAges() {
  if (dryRun) return new Map();
  const rows = await d1('SELECT ticker, eod_fetched_at FROM price_history');
  return new Map(rows.map((r) => [r.ticker, r.eod_fetched_at]));
}

const CONCURRENCY = 4;

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pool(items, limit, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

/**
 * Drops symbols the company directory knows are not listed, and (once the directory is populated) symbols it has
 * never seen, such as half-typed searches. An empty directory filters nothing.
 */
async function listedOnly(tickers) {
  if (dryRun) return { kept: tickers, skipped: [] };
  const rows = await d1('SELECT ticker, listing_status FROM security_catalog').catch(() => []);
  if (!rows.length) return { kept: tickers, skipped: [] };
  const listed = new Set(rows.filter((r) => r.listing_status !== 'delisted').map((r) => r.ticker));
  return { kept: tickers.filter((t) => listed.has(t)), skipped: tickers.filter((t) => !listed.has(t)) };
}

async function main() {
  const { kept, skipped } = await listedOnly(await trackedTickers(tickerArg));
  const tickers = kept;
  const ages = await storedAges();
  const now = new Date();
  const failed = [];
  let ok = 0;
  // One page token serves every request in a run; refresh it once if PSX rejects it.
  let token = tickers.length ? await fetchPsxToken(tickers[0]) : '';
  let tokenRefresh = null;
  const refreshToken = (stale) => {
    if (token !== stale) return Promise.resolve(token);
    tokenRefresh ??= fetchPsxToken(tickers[0]).then((fresh) => ((token = fresh), fresh)).finally(() => (tokenRefresh = null));
    return tokenRefresh;
  };
  const series = async (ticker, kind) => {
    const used = token;
    try {
      return await fetchPsxTimeseries(ticker, kind, used);
    } catch (error) {
      if (!/^40[134] /.test(error instanceof Error ? error.message : '')) throw error;
      return fetchPsxTimeseries(ticker, kind, await refreshToken(used));
    }
  };
  // KSE100 rides along for the market-pulse sparkline.
  if (!tickerArg && tickers.length) tickers.push('KSE100');
  await pool(tickers, CONCURRENCY, async (ticker) => {
    try {
      const intraday = parseIntraday(await series(ticker, 'int'));
      const eodAt = ages.get(ticker);
      const stale = refreshEod || !eodAt || now - new Date(eodAt) > EOD_MAX_AGE_MS;
      const eod = stale ? parseEod(await series(ticker, 'eod')).slice(-eodKeep(ticker)) : null;
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
  });
  console.log(
    `PSX history: ${ok}/${tickers.length} tickers` +
      (skipped.length ? ` (skipped unlisted: ${skipped.join(', ')})` : '') +
      (failed.length ? `. Failed: ${failed.join('; ')}` : '.'),
  );
  process.exitCode = scrapeExitCode(tickers.length, failed.length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

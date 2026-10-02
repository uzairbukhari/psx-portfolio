// Refreshes the shared `quote_refreshes` cache from outside Cloudflare.
//
// PSX's dps.psx.com.pk drops requests from Cloudflare's network (Workers get a
// 520 on every page except the homepage), so the Workers can no longer fetch
// prices themselves. This script runs on GitHub Actions (see
// .github/workflows/psx-quotes.yml): one request to /indices/ALLSHR prices every
// All-Share stock, the homepage supplies the market timestamp, and any held
// ticker missing from ALLSHR (e.g. ETFs) falls back to its company page. Only
// tickers held in some portfolio go into `quote_refreshes`; the KSE100 summary,
// a per-day KSE100 chart and the whole ALLSHR table go into
// `market_summary_refreshes` for the market pulse. Writes use the D1 REST API.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/psx-quote-scrape.mjs [--dry-run] [--tickers=MEBL,LUCK]
import { pathToFileURL } from 'node:url';
import { d1, heldTickers as sharedHeldTickers } from './d1-rest.mjs';
import { scrapeExitCode } from './scrape-exit.mjs';
import { fetchPsx } from '../lib/psx-fetch.ts';
import { parseIndexConstituents, parseIndexSummary } from '../lib/psx-market.ts';
import { fetchPsxQuote } from '../lib/psx-quotes.ts';
import { quoteUpsertSql } from '../lib/quote-write.ts';

const MAX_FALLBACK = 20;
// D1 allows 100 bound parameters per statement; 7 per row.
const ROWS_PER_STATEMENT = 14;
const SOURCE = 'https://dps.psx.com.pk/indices/ALLSHR';

const dryRun = process.argv.includes('--dry-run');
const tickerArg = process.argv.find((arg) => arg.startsWith('--tickers='));

const heldTickers = () => sharedHeldTickers(tickerArg);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-09-29 10:53:30" (PKT) -> "Tue, Sep 29, 2026 10:53 AM", the company-page format. */
export function psxAsOf(stamp) {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) throw Error(`Unrecognised PSX timestamp "${stamp}"`);
  const [, year, month, day, hour, minute] = match.map(Number);
  const weekday = DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const hour12 = hour % 12 || 12;
  return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year} ${hour12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

const MAX_SERIES_POINTS = 120;

/** "2026-09-29 11:33:30" in PKT (UTC+5) -> Unix seconds. */
function pktSeconds(stamp) {
  const [date, time = '00:00:00'] = stamp.split(' ');
  return Math.round((Date.parse(`${date}T${time}Z`) - 5 * 3_600_000) / 1000);
}

/**
 * Builds the `market_summary_refreshes` payload the market pulse reads. PSX's
 * intraday /timeseries endpoint is gone, so the KSE100 chart is grown one point
 * per scrape and reset each trading day; `quotes` is the full ALLSHR table so
 * shortlisted companies get price and day change even when nobody holds them.
 */
export function buildMarketSummary(previous, index, constituents, retrievedAt) {
  const dayStart = pktSeconds(`${index.date} 00:00:00`);
  const time = pktSeconds(index.asOf);
  const series = (Array.isArray(previous?.series) ? previous.series : []).filter(
    (point) => point.time >= dayStart && point.time < time,
  );
  series.push({ time, value: index.close });
  return {
    index,
    series: series.slice(-MAX_SERIES_POINTS),
    quotes: constituents.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      price: row.price,
      change: row.change,
      changePercent: row.changePercent,
      volume: row.volume,
      high: null,
      low: null,
      sourceTimestamp: index.asOf,
      retrievedAt,
    })),
  };
}

async function writeMarketSummary(index, constituents, retrievedAt) {
  const [row] = await d1("SELECT payload FROM market_summary_refreshes WHERE id='latest'");
  let previous = null;
  try {
    previous = row ? JSON.parse(row.payload) : null;
  } catch {
    previous = null;
  }
  const payload = buildMarketSummary(previous, index, constituents, retrievedAt);
  await d1(
    `INSERT INTO market_summary_refreshes (id,payload,fetched_at,updated_at)
     VALUES ('latest',?,?,?)
     ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
    [JSON.stringify(payload), retrievedAt, retrievedAt],
  );
  return payload.series.length;
}

async function main() {
  const tickers = await heldTickers();
  const [home, allshr] = await Promise.all([
    fetchPsx('https://dps.psx.com.pk/').then((response) => response.text()),
    fetchPsx(SOURCE).then((response) => response.text()),
  ]);
  const index = parseIndexSummary(home, 'KSE100');
  const stamp = index.asOf;
  const asOf = psxAsOf(stamp);
  const date = stamp.slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const constituents = parseIndexConstituents(allshr);
  const bySymbol = new Map(constituents.map((row) => [row.symbol, row]));

  const quotes = {};
  const missing = [];
  for (const ticker of tickers) {
    const row = bySymbol.get(ticker);
    if (row) quotes[ticker] = { price: row.price, asOf, date, source: SOURCE, fetchedAt };
    else missing.push(ticker);
  }
  const failed = [];
  for (const ticker of missing.slice(0, MAX_FALLBACK)) {
    try {
      quotes[ticker] = await fetchPsxQuote(ticker);
    } catch (error) {
      failed.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const entries = Object.entries(quotes);
  console.log(
    `PSX ${asOf}: ${entries.length}/${tickers.length} held tickers priced` +
      (missing.length ? ` (${missing.length} via company page)` : '') +
      (failed.length ? `. Failed: ${failed.join('; ')}` : '.'),
  );
  if (dryRun) {
    for (const [ticker, quote] of entries) console.log(`  ${ticker} ${quote.price} (${quote.asOf})`);
    console.log(`  KSE100 ${index.close} ${index.changePercent}% · ${constituents.length} ALLSHR quotes`);
    return;
  }
  const now = new Date().toISOString();
  for (let index = 0; index < entries.length; index += ROWS_PER_STATEMENT) {
    const chunk = entries.slice(index, index + ROWS_PER_STATEMENT);
    await d1(
      quoteUpsertSql(chunk.length),
      chunk.flatMap(([ticker, quote]) => [
        ticker,
        quote.price,
        quote.asOf,
        quote.date,
        quote.source,
        quote.fetchedAt,
        now,
      ]),
    );
  }
  const points = await writeMarketSummary(index, constituents, fetchedAt);
  console.log(`Market summary: KSE100 ${index.close} (${points} chart points), ${constituents.length} ALLSHR quotes.`);
  process.exitCode = scrapeExitCode(tickers.length, tickers.length - entries.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

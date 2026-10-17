// Stores today's USD, AED and SAR rates in rupees in the shared `fx_rates` table and the packed `fx_rate_history`
// (public data, no user data).
//   interbank    open.er-api.com dollar rates; the dirham and riyal must sit at their dollar pegs or the run fails.
//   open_market  buying rates read from a public exchange-rate page. The page has no API, so `parseOpenMarketPage`
//                insists on every currency within 3% of interbank; a redesigned page is reported and skipped, and the
//                app falls back to interbank with an "estimate" badge.
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/fx-rates-scrape.mjs [--dry-run]
import { d1, trackRun } from './d1-rest.mjs';
import { interbankFromDollar, mergeYear, parseDollarRates, parseOpenMarketPage, SUPPORTED_CURRENCIES } from '../lib/fx-rates.ts';

const dryRun = process.argv.includes('--dry-run');
trackRun('fx', { dryRun });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
const OPEN_MARKET_URL = 'https://www.forex.pk/open_market_rates.asp';
const pktToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

const date = pktToday();
const fetchedAt = new Date().toISOString();
const rows = [];
const problems = [];

const response = await fetch('https://open.er-api.com/v6/latest/USD', { headers: UA, signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw Error(`${response.status} from open.er-api.com`);
const dollar = parseDollarRates(await response.json());
if (!dollar) throw Error('dollar rates missing, implausible, or the dirham/riyal left their pegs');
const interbank = interbankFromDollar(dollar);
for (const currency of SUPPORTED_CURRENCIES)
  rows.push({ currency, kind: 'interbank', rate: interbank[currency], sourceUrl: 'https://open.er-api.com/', sourceLabel: `Interbank, Rs ${dollar.PKR}/USD` });

try {
  const page = await fetch(OPEN_MARKET_URL, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!page.ok) throw Error(`${page.status} from ${new URL(OPEN_MARKET_URL).host}`);
  const open = parseOpenMarketPage(await page.text(), interbank);
  if (!open) throw Error('open-market page no longer matches the expected layout');
  for (const currency of SUPPORTED_CURRENCIES)
    rows.push({ currency, kind: 'open_market', rate: open[currency], sourceUrl: OPEN_MARKET_URL, sourceLabel: 'Open market buying rate' });
} catch (error) {
  problems.push(`open-market rates: ${error.message}`);
}

for (const row of rows) console.log(`${date} ${row.currency} ${row.kind}: Rs ${row.rate.toFixed(4)}`);
for (const problem of problems) console.error(`warning: ${problem}`);

if (!dryRun) {
  const year = date.slice(0, 4);
  for (const row of rows) {
    await d1(
      `INSERT INTO fx_rates (currency,kind,date,pkr_per_unit,source_url,source_label,fetched_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(currency,kind,date) DO UPDATE SET pkr_per_unit=excluded.pkr_per_unit, source_url=excluded.source_url, source_label=excluded.source_label, fetched_at=excluded.fetched_at`,
      [row.currency, row.kind, date, row.rate, row.sourceUrl, row.sourceLabel, fetchedAt],
    );
    // Keep the packed year in step: read the one row, merge today in, write it back (a primary-key read and write).
    const [existing] = await d1('SELECT closes FROM fx_rate_history WHERE currency=? AND kind=? AND year=?', [row.currency, row.kind, year]);
    await d1(
      `INSERT INTO fx_rate_history (currency,kind,year,closes,updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(currency,kind,year) DO UPDATE SET closes=excluded.closes, updated_at=excluded.updated_at`,
      [row.currency, row.kind, year, mergeYear(existing?.closes ?? null, { date, rate: row.rate }), fetchedAt],
    );
  }
}
// Open-market failing is reported but does not fail the run while interbank stored; the app falls back.

// Stores today's gold and silver prices in the shared `metal_rates` table (public data, no user data).
//   local          the 24K gold price per tola that Pakistani dealers quote, read from gold.pk. The page has no API, so
//                  `parseGoldPage` insists on two agreeing numbers and a redesigned page fails loudly instead of
//                  storing a wrong price. Silver has no local source yet; it uses the international estimate.
//   international  world spot price in USD per ounce (gold-api.com) times the dollar rate (open.er-api.com), per tola.
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/metal-rates-scrape.mjs [--dry-run]
import { d1 } from './d1-rest.mjs';
import { parseGoldPage, tolaFromSpot } from '../lib/metal-rates.ts';

const dryRun = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
const pktToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const getJson = async (url) => {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`${response.status} from ${new URL(url).host}`);
  return response.json();
};

const date = pktToday();
const fetchedAt = new Date().toISOString();
const rows = [];
const problems = [];

try {
  const url = 'https://gold.pk/';
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`${response.status} from gold.pk`);
  const parsed = parseGoldPage(await response.text());
  if (!parsed) throw Error('gold.pk page no longer matches the expected layout');
  rows.push({ metal: 'gold', kind: 'local', pkrPerTola: parsed.pkrPerTola, sourceUrl: url, sourceLabel: 'gold.pk 24K per tola' });
} catch (error) {
  problems.push(`local gold rate: ${error.message}`);
}

try {
  const [gold, silver, fx] = await Promise.all([
    getJson('https://api.gold-api.com/price/XAU'),
    getJson('https://api.gold-api.com/price/XAG'),
    getJson('https://open.er-api.com/v6/latest/USD'),
  ]);
  const pkr = fx?.rates?.PKR;
  if (!(pkr > 100 && pkr < 1000)) throw Error('dollar rate missing or implausible');
  for (const [metal, quote] of [['gold', gold], ['silver', silver]]) {
    if (!(quote?.price > 0)) throw Error(`${metal} spot price missing`);
    rows.push({ metal, kind: 'international', pkrPerTola: Math.round(tolaFromSpot(quote.price, pkr)), sourceUrl: 'https://api.gold-api.com/', sourceLabel: `spot $${quote.price}/oz x Rs ${pkr}/USD` });
  }
} catch (error) {
  problems.push(`international rate: ${error.message}`);
}

for (const row of rows) console.log(`${date} ${row.metal} ${row.kind}: Rs ${row.pkrPerTola.toLocaleString('en-PK')} per tola`);
for (const problem of problems) console.error(`warning: ${problem}`);
if (!rows.length) throw Error('No metal rate could be read.');

if (!dryRun)
  for (const row of rows)
    await d1(
      `INSERT INTO metal_rates (date,metal,kind,pkr_per_tola,source_url,source_label,fetched_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(date,metal,kind) DO UPDATE SET pkr_per_tola=excluded.pkr_per_tola, source_url=excluded.source_url, source_label=excluded.source_label, fetched_at=excluded.fetched_at`,
      [date, row.metal, row.kind, row.pkrPerTola, row.sourceUrl, row.sourceLabel, fetchedAt],
    );
// A source that failed is reported but does not fail the run while the other one stored a rate; the app falls back.

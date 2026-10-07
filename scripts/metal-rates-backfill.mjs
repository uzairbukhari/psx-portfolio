// One-time backfill of five years of gold and silver history into `metal_rates` (public data, no user data).
// World futures prices (Yahoo Finance GC=F, SI=F, USD per ounce) times the daily dollar rate (PKR=X), per tola, stored
// as kind 'international'. Existing rows are never overwritten, so the dealer rates and live scrapes stay as they are.
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/metal-rates-backfill.mjs [--dry-run]
import { d1 } from './d1-rest.mjs';
import { backfillRows, parseYahooChart } from '../lib/metal-history.ts';

const dryRun = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
const chart = async (symbol) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`${response.status} from Yahoo for ${symbol}`);
  return parseYahooChart(await response.json());
};

const [gold, silver, fx] = await Promise.all([chart('GC=F'), chart('SI=F'), chart('PKR=X')]);
if (gold.length < 500 || silver.length < 500 || fx.length < 500)
  throw Error(`Too little history (gold ${gold.length}, silver ${silver.length}, dollar ${fx.length} days); refusing to write.`);
const rows = [...backfillRows('gold', gold, fx), ...backfillRows('silver', silver, fx)];
console.log(`${rows.length} rows, ${rows[0]?.date} to ${rows.at(-1)?.date}`);
for (const metal of ['gold', 'silver']) {
  const mine = rows.filter((r) => r.metal === metal);
  console.log(`${metal}: first ${mine[0]?.date} Rs ${mine[0]?.pkrPerTola}, last ${mine.at(-1)?.date} Rs ${mine.at(-1)?.pkrPerTola}`);
}
if (dryRun) process.exit(0);

const fetchedAt = new Date().toISOString();
const label = 'Backfill: Yahoo Finance futures x daily PKR=X';
const BATCH = 12; // D1 allows 100 bound parameters per statement
for (let i = 0; i < rows.length; i += BATCH) {
  const part = rows.slice(i, i + BATCH);
  await d1(
    `INSERT OR IGNORE INTO metal_rates (date,metal,kind,pkr_per_tola,source_url,source_label,fetched_at) VALUES ${part.map(() => '(?,?,?,?,?,?,?)').join(',')}`,
    part.flatMap((r) => [r.date, r.metal, 'international', r.pkrPerTola, 'https://finance.yahoo.com/', label, fetchedAt]),
  );
}
console.log('Done.');

// One-time backfill of five years of USD, AED and SAR interbank history (rupees per unit) into `fx_rate_history`
// (public data, no user data). Yahoo Finance daily closes of PKR=X, AEDPKR=X and SARPKR=X. Days already stored in a
// packed year are kept; only missing dates are added. Open-market history starts the day scraping starts.
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/fx-rates-backfill.mjs [--dry-run]
import { d1 } from './d1-rest.mjs';
import { parseYahooChart } from '../lib/metal-history.ts';
import { packYears } from '../lib/fx-rates.ts';

const dryRun = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
const SYMBOLS = { USD: 'PKR=X', AED: 'AEDPKR=X', SAR: 'SARPKR=X' };
const chart = async (symbol) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`${response.status} from Yahoo for ${symbol}`);
  return parseYahooChart(await response.json());
};

const fetchedAt = new Date().toISOString();
for (const [currency, symbol] of Object.entries(SYMBOLS)) {
  const closes = await chart(symbol);
  if (closes.length < 500) throw Error(`Too little history for ${currency} (${closes.length} days); refusing to write.`);
  const bad = closes.filter((c) => !(c.close > 0.5 && c.close < 1000));
  if (bad.length) throw Error(`${currency}: ${bad.length} implausible closes (first ${bad[0].date} ${bad[0].close}); refusing to write.`);
  const packed = packYears(currency, 'interbank', closes.map((c) => ({ date: c.date, rate: c.close })));
  console.log(`${currency}: ${closes.length} days, ${closes[0].date} Rs ${closes[0].close} to ${closes.at(-1).date} Rs ${closes.at(-1).close}`);
  if (dryRun) continue;
  for (const p of packed) {
    const [existing] = await d1('SELECT closes FROM fx_rate_history WHERE currency=? AND kind=? AND year=?', [p.currency, p.kind, p.year]);
    const have = new Map(existing ? JSON.parse(existing.closes) : []);
    const merged = new Map([...JSON.parse(p.closes), ...have]); // existing (scraped) values win
    const text = JSON.stringify([...merged].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    await d1(
      `INSERT INTO fx_rate_history (currency,kind,year,closes,updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(currency,kind,year) DO UPDATE SET closes=excluded.closes, updated_at=excluded.updated_at`,
      [p.currency, p.kind, p.year, text, fetchedAt],
    );
  }
}
console.log(dryRun ? 'Dry run, nothing written.' : 'Done.');

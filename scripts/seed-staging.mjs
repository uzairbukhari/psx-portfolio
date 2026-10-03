// Writes a small FICTIONAL ledger to a local file so a staging tester can restore it through the app and see
// every tab populated. It touches no database at all: portfolios are encrypted on the device, so the server can
// neither be seeded with one nor read one.
//
// Usage: node scripts/seed-staging.mjs [--out=staging-seed-ledger.json] [--dry-run]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const COMPANIES = [
  ['MEBL', 'Meezan Bank', 'Bank', 15],
  ['LUCK', 'Lucky Cement', 'Cement', 15],
  ['OGDC', 'Oil & Gas Development', 'Oil & Gas', 10],
  ['HUBC', 'Hub Power', 'Others', 10],
  ['ENGRO', 'Engro Corporation', 'Others', 10],
  ['SYS', 'Systems', 'Technology', 15],
];

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of day `day` in the month that is `monthsAgo` before `today`'s month. */
function pastDate(today, monthsAgo, day) {
  const [year, month] = today.split('-').map(Number);
  const index = year * 12 + (month - 1) - monthsAgo;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-${pad(day)}`;
}

/**
 * Fictional portfolio in the real payload shape (lib/portfolio.ts `Portfolio`).
 * All dates fall in earlier months than `today` (`YYYY-MM-DD`, PKT) so the
 * ledger's "no future dates" validation always passes. Prices are made up.
 */
export function buildSeedPortfolio(today, now = new Date()) {
  const fetchedAt = now.toISOString();
  const buys = [
    // [monthsAgo, day, ticker, shares, price]
    [5, 9, 'MEBL', 100, 280],
    [5, 16, 'LUCK', 40, 1010],
    [4, 8, 'OGDC', 200, 205],
    [4, 15, 'HUBC', 120, 190],
    [3, 10, 'MEBL', 50, 305],
    [3, 17, 'ENGRO', 60, 330],
    [2, 9, 'LUCK', 20, 1100],
    [2, 16, 'SYS', 150, 128],
    [1, 8, 'OGDC', 100, 225],
    [1, 15, 'HUBC', 60, 205],
  ];
  const trades = buys.map(([ago, day, ticker, shares, price], i) => {
    const date = pastDate(today, ago, day);
    return {
      id: `seed-buy-${i + 1}`,
      ticker,
      kind: 'buy',
      date,
      shares,
      price,
      fees: Math.round(shares * price * 0.0025 * 100) / 100,
      month: date.slice(0, 7),
      note: 'Seed data',
    };
  });
  trades.push({
    id: 'seed-sell-1',
    ticker: 'OGDC',
    kind: 'sell',
    date: pastDate(today, 1, 22),
    shares: 100,
    price: 238,
    fees: 59.5,
    month: '',
    note: 'Seed data',
  });
  const dividends = [
    ['MEBL', 3, 20, 7],
    ['HUBC', 2, 24, 4],
    ['OGDC', 2, 26, 3.5],
    ['LUCK', 1, 25, 10],
  ].map(([ticker, ago, day, perShare], i) => {
    const date = pastDate(today, ago, day);
    const shares = trades
      .filter((t) => t.ticker === ticker && t.date < date)
      .reduce((n, t) => n + (t.kind === 'sell' ? 0 - t.shares : t.shares), 0);
    const gross = Math.round(shares * perShare * 100) / 100;
    return {
      id: `seed-div-${i + 1}`,
      ticker,
      date,
      source: 'manual',
      perShare,
      grossAmount: gross,
      taxWithheld: Math.round(gross * 0.15 * 100) / 100,
      status: 'received',
      note: 'Seed data',
    };
  });
  const quoted = { MEBL: 320, LUCK: 1150, OGDC: 230, HUBC: 210, ENGRO: 345, SYS: 135 };
  return {
    companies: COMPANIES.map(([ticker, name, sector, target]) => ({
      ticker,
      name,
      sector,
      target,
      approved: true,
      screenDate: pastDate(today, 6, 1),
      note: 'Fictional staging seed company entry.',
    })),
    trades,
    quotes: Object.fromEntries(
      Object.entries(quoted).map(([ticker, price]) => [
        ticker,
        { price, asOf: today, date: today, source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt },
      ]),
    ),
    budgets: { [today.slice(0, 7)]: 100000 },
    dividends,
    dividendTrackingFrom: today,
    taxProfile: { filerStatus: 'filer' },
  };
}

/**
 * The fictional ledger as a plain backup file a tester restores through the app (Settings > Restore a backup),
 * which encrypts it under their own vault. Nothing here is written to any database: portfolios are end-to-end
 * encrypted, so the server cannot be seeded with one and there is no private data to seed it with.
 */
export function buildSeedBackup(today, now = new Date()) {
  return { kind: 'psx-portfolio-ledger', schemaVersion: 1, portfolio: buildSeedPortfolio(today, now) };
}

const pktToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

function main() {
  const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length) || 'staging-seed-ledger.json';
  const backup = buildSeedBackup(pktToday());
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(backup, null, 2));
    return;
  }
  writeFileSync(out, JSON.stringify(backup, null, 2));
  console.log(`Wrote the fictional staging ledger to ${out}. Restore it in the staging app; it is encrypted on your device.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

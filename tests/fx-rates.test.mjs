import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  chooseFxRate,
  interbankFromDollar,
  mergeYear,
  packYears,
  parseDollarRates,
  parseOpenMarketPage,
  unpackYears,
} from '../lib/fx-rates.ts';
import { readFxRates } from '../lib/fx-rates-store.ts';

const row = (kind, date, pkrPerUnit, currency = 'USD') => ({ date, currency, kind, pkrPerUnit, sourceUrl: 'x', fetchedAt: 'x' });

test('open-market rate wins while fresh, interbank takes over when it is old', () => {
  const rows = [row('open_market', '2026-10-15', 281), row('interbank', '2026-10-17', 282.4)];
  assert.equal(chooseFxRate(rows, 'USD', '2026-10-17').kind, 'open_market');
  const late = chooseFxRate(rows, 'USD', '2026-10-18');
  assert.equal(late.kind, 'interbank');
  assert.equal(late.fellBack, true);
  assert.equal(chooseFxRate(rows, 'AED', '2026-10-17'), null);
  assert.equal(chooseFxRate([row('interbank', '2026-10-01', 280)], 'USD', '2026-10-17').stale, true);
});

test('dollar rates must hold the pegs', () => {
  const good = parseDollarRates({ rates: { PKR: 282.5, AED: 3.6725, SAR: 3.75 } });
  assert.deepEqual(interbankFromDollar(good).USD, 282.5);
  assert.ok(Math.abs(interbankFromDollar(good).AED - 282.5 / 3.6725) < 1e-9);
  assert.equal(parseDollarRates({ rates: { PKR: 282.5, AED: 4.2, SAR: 3.75 } }), null);
  assert.equal(parseDollarRates({ rates: { PKR: 5, AED: 3.6725, SAR: 3.75 } }), null);
  assert.equal(parseDollarRates({}), null);
});

test('open-market page parser accepts a plausible table and rejects a changed one', () => {
  const inter = { USD: 282.5, AED: 76.9, SAR: 75.3 };
  const html = '<tr><td>US Dollar</td><td>281.50</td><td>283.00</td></tr><tr><td>UAE Dirham</td><td>76.40</td><td>77.20</td></tr><tr><td>Saudi Riyal</td><td>74.90</td><td>75.80</td></tr>';
  assert.deepEqual(parseOpenMarketPage(html, inter), { USD: 281.5, AED: 76.4, SAR: 74.9 });
  assert.equal(parseOpenMarketPage(html.replace('281.50', '1.50'), inter), null);
  assert.equal(parseOpenMarketPage('<p>nothing</p>', inter), null);
});

test('packing keeps one row per year and merges new days', () => {
  const packed = packYears('USD', 'interbank', [
    { date: '2025-12-31', rate: 280 },
    { date: '2026-01-02', rate: 281 },
    { date: '2026-01-03', rate: 281.5 },
  ]);
  assert.deepEqual(packed.map((p) => p.year), ['2025', '2026']);
  const next = mergeYear(packed[1].closes, { date: '2026-01-03', rate: 282 });
  assert.deepEqual(JSON.parse(next), [['2026-01-02', 281], ['2026-01-03', 282]]);
  assert.equal(mergeYear('garbage', { date: '2026-01-04', rate: 1 }), '[["2026-01-04",1]]');
  const back = unpackYears(packed.map(({ currency, kind, closes }) => ({ currency, kind, closes })));
  assert.equal(back.length, 3);
  assert.equal(unpackYears([{ currency: 'EUR', kind: 'interbank', closes: '[]' }]).length, 0);
});

test('reading rates touches few rows and always uses an index', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0037_friendly_doomsday.sql'])
    sql.exec(readFileSync(new URL(`../drizzle/${f}`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const ins = sql.prepare('INSERT INTO fx_rates VALUES (?,?,?,?,?,?,?)');
  for (let i = 0; i < 400; i++)
    for (const c of ['USD', 'AED', 'SAR'])
      ins.run(c, 'interbank', new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), 280, 'u', null, 'f');
  sql.prepare('INSERT INTO fx_rate_history VALUES (?,?,?,?,?)').run('USD', 'interbank', '2026', '[["2026-01-01",280]]', 'u');
  const plan = (q, ...args) => sql.prepare(`EXPLAIN QUERY PLAN ${q}`).all(...args).map((r) => r.detail).join(' | ');
  assert.match(plan('SELECT * FROM fx_rates WHERE date>=? ORDER BY date,currency,kind', '2027-01-01'), /SEARCH fx_rates USING (COVERING )?INDEX fx_rates_date_idx/);
  assert.match(plan('SELECT * FROM fx_rate_history WHERE year>=?', '2021'), /SEARCH|SCAN fx_rate_history/);
  const db = { prepare: (q) => ({ bind: (...a) => ({ all: async () => ({ results: sql.prepare(q).all(...a) }) }) }) };
  const out = await readFxRates(db, '2027-02-05');
  assert.ok(out.rates.length <= 30 && out.history.length === 1);
});

test('the fx route takes no parameters and the client call carries none', () => {
  const route = readFileSync(new URL('../app/api/public-data/fx/route.ts', import.meta.url), 'utf8');
  assert.ok(!/searchParams|req\.json|request\.json/.test(route));
});

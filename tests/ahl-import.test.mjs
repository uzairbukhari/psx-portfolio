import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAhlHistory, importAhlTrades } from '../app/ahl-import.ts';
import { validate } from '../lib/portfolio.ts';

const history = JSON.parse(readFileSync(new URL('../../ahl-history.json', import.meta.url), 'utf8'));
const portfolio = () => ({ companies: [], trades: [], quotes: {}, budgets: {} });

test('parses the supplied AHL history and derives buy and sell fees', () => {
  const rows = parseAhlHistory(history);
  assert.equal(rows.length, 80);
  assert.deepEqual(rows[0], {
    ticker: 'PPL', date: '2024-11-28', kind: 'buy', price: 157.3,
    shares: 30, fees: 8.292, externalId: 'ahl:PPL|buy|2024-11-28|30|157.3|8.292|1',
  });
  assert.equal(rows.find((row) => row.kind === 'sell').fees, 7.4123);
});

test('imports all AHL rows once, preserves identical fills, and adds companies unapproved', () => {
  const rows = parseAhlHistory(history);
  const first = importAhlTrades(portfolio(), rows);
  assert.equal(first.imported, 80);
  assert.equal(first.trades.filter((trade) => trade.kind === 'opening').length, 1);
  assert.equal(first.trades.find((trade) => trade.kind === 'opening').ticker, 'JSRR');
  assert.equal(first.trades.filter((trade) => trade.ticker === 'ISL' && trade.price === 81.5).length, 2);
  assert.ok(first.companies.every((company) => !company.approved && company.target === 0));
  const saved = { ...portfolio(), companies: first.companies, trades: first.trades };
  validate(saved);
  const second = importAhlTrades(saved, rows);
  assert.equal(second.imported, 0);
  assert.equal(second.skippedDuplicate, 80);
});

test('AHL history reconciles an opening snapshot only when quantities match on its date', () => {
  const rows = parseAhlHistory(history);
  const p = portfolio();
  p.companies.push({ ticker: 'MEBL', name: 'Meezan Bank', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'opening-MEBL', ticker: 'MEBL', kind: 'opening', date: '2026-09-09', shares: 615, price: null, fees: 0, month: '', note: 'AHL opening balance' });
  const result = importAhlTrades(p, rows);
  assert.deepEqual(result.voidedTradeIds, ['opening-MEBL']);
});

test('AHL import skips exact manual matches and rejects an invalid row', () => {
  const [row] = parseAhlHistory(history);
  const p = portfolio();
  p.companies.push({ ticker: row.ticker, name: row.ticker, sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'manual', ticker: row.ticker, kind: row.kind, date: row.date, shares: row.shares, price: row.price, fees: row.fees, month: row.date.slice(0, 7), note: '' });
  assert.equal(importAhlTrades(p, [row]).skippedManualMatch, 1);
  assert.throws(() => parseAhlHistory([{ ...history[0], quantity: 0 }]));
});

test('AHL reconciliation applies stock splits before later trades and snapshots', () => {
  const p = portfolio();
  p.companies.push({ ticker: 'SYS', name: 'Systems', sector: 'Technology', target: 0, approved: false, screenDate: '', note: '' });
  p.stockSplits = [{ id: 'split', ticker: 'SYS', date: '2025-06-02', oldShares: 1, newShares: 5, note: '' }];
  p.trades.push({ id: 'opening', ticker: 'SYS', kind: 'opening', date: '2025-10-01', shares: 56, price: null, fees: 0, month: '', note: '' });
  const rows = [
    { ticker: 'SYS', date: '2025-02-01', kind: 'buy', price: 500, shares: 10, fees: 1, externalId: 'ahl:pre' },
    { ticker: 'SYS', date: '2025-09-01', kind: 'buy', price: 150, shares: 6, fees: 1, externalId: 'ahl:post' },
  ];
  const result = importAhlTrades(p, rows);
  assert.deepEqual(result.voidedTradeIds, ['opening']);

  const closed = importAhlTrades({ ...p, trades: [] }, [
    rows[0],
    { ticker: 'SYS', date: '2025-09-01', kind: 'sell', price: 150, shares: 50, fees: 1, externalId: 'ahl:sale' },
  ]);
  assert.equal(closed.trades.filter((entry) => entry.kind === 'opening').length, 0);
});

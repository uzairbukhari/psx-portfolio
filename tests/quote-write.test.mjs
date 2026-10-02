import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { quoteUpsertSql } from '../lib/quote-write.ts';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE quote_refreshes (ticker TEXT PRIMARY KEY, price REAL NOT NULL, as_of TEXT NOT NULL, quote_date TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
  return d;
}
const write = (d, ticker, price, date, fetchedAt) =>
  d.prepare(quoteUpsertSql(1)).run(ticker, price, 'x', date, 's', fetchedAt, 'u');
const price = (d) => d.prepare("SELECT price FROM quote_refreshes WHERE ticker='AAA'").get().price;

test('a late writer with an older fetch cannot replace a newer quote', () => {
  const d = db();
  write(d, 'AAA', 110, '2026-10-02', '2026-10-02T10:05:00Z');
  write(d, 'AAA', 100, '2026-10-02', '2026-10-02T10:00:00Z');
  assert.equal(price(d), 110);
});

test('an older trading day never replaces a newer one even with a later fetch', () => {
  const d = db();
  write(d, 'AAA', 110, '2026-10-02', '2026-10-02T10:00:00Z');
  write(d, 'AAA', 90, '2026-10-01', '2026-10-02T11:00:00Z');
  assert.equal(price(d), 110);
});

test('newer observations replace older ones', () => {
  const d = db();
  write(d, 'AAA', 100, '2026-10-01', '2026-10-01T10:00:00Z');
  write(d, 'AAA', 105, '2026-10-01', '2026-10-01T10:05:00Z');
  write(d, 'AAA', 120, '2026-10-02', '2026-10-02T09:00:00Z');
  assert.equal(price(d), 120);
});

test('multi-row batches apply the rule per row', () => {
  const d = db();
  write(d, 'AAA', 110, '2026-10-02', '2026-10-02T10:05:00Z');
  d.prepare(quoteUpsertSql(2)).run('AAA', 1, 'x', '2026-10-02', 's', '2026-10-02T09:00:00Z', 'u', 'BBB', 7, 'x', '2026-10-02', 's', '2026-10-02T09:00:00Z', 'u');
  assert.equal(price(d), 110);
  assert.equal(d.prepare("SELECT price FROM quote_refreshes WHERE ticker='BBB'").get().price, 7);
});

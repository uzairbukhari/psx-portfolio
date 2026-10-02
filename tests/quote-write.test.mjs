import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { quoteUpsertSql, quoteObservedAt } from '../lib/quote-write.ts';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE quote_refreshes (ticker TEXT PRIMARY KEY, price REAL NOT NULL, as_of TEXT NOT NULL, quote_date TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL, updated_at TEXT NOT NULL, observed_at TEXT)');
  return d;
}
const write = (d, ticker, price, date, fetchedAt, observedAt = null) =>
  d.prepare(quoteUpsertSql(1)).run(ticker, price, 'x', date, 's', fetchedAt, 'u', observedAt);
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
  d.prepare(quoteUpsertSql(2)).run('AAA', 1, 'x', '2026-10-02', 's', '2026-10-02T09:00:00Z', 'u', null, 'BBB', 7, 'x', '2026-10-02', 's', '2026-10-02T09:00:00Z', 'u', null);
  assert.equal(price(d), 110);
  assert.equal(d.prepare("SELECT price FROM quote_refreshes WHERE ticker='BBB'").get().price, 7);
});

test('same day: the later source time wins even when it was fetched earlier', () => {
  const d = db();
  write(d, 'AAA', 110, '2026-10-02', '2026-10-02T10:00:00Z', '2026-10-02T09:55:00Z');
  write(d, 'AAA', 120, '2026-10-02', '2026-10-02T09:00:00Z', '2026-10-02T09:58:00Z');
  assert.equal(price(d), 120, 'quoted later, even though the response was fetched earlier');
  write(d, 'AAA', 90, '2026-10-02', '2026-10-02T11:00:00Z', '2026-10-02T09:30:00Z');
  assert.equal(price(d), 120, 'quoted earlier, even though it was fetched later');
});

test('an unknown source time never replaces a known one, while a known one supersedes an unknown one', () => {
  const d = db();
  write(d, 'AAA', 110, '2026-10-02', '2026-10-02T10:00:00Z', '2026-10-02T09:55:00Z');
  write(d, 'AAA', 1, '2026-10-02', '2026-10-02T12:00:00Z', null);
  assert.equal(price(d), 110);
  const e = db();
  write(e, 'AAA', 5, '2026-10-02', '2026-10-02T10:00:00Z', null);
  write(e, 'AAA', 6, '2026-10-02', '2026-10-02T09:00:00Z', '2026-10-02T09:00:00Z');
  assert.equal(price(e), 6);
});

test('quoteObservedAt reads PSX display time as Pakistan time', () => {
  assert.equal(quoteObservedAt('Tue, Sep 29, 2026 10:53 AM'), '2026-09-29T05:53:00.000Z');
  assert.equal(quoteObservedAt('Fri, Oct 2, 2026 3:30 PM'), '2026-10-02T10:30:00.000Z');
  assert.equal(quoteObservedAt('Fri, Oct 2, 2026'), null);
  assert.equal(quoteObservedAt('garbage'), null);
});

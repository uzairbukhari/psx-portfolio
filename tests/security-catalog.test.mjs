import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { applyCatalog, catalogRowParams, catalogUpsertSql, readCatalog, CATALOG_CHUNK } from '../lib/security-catalog.ts';

test('catalog upsert keeps first_seen and ignores an older observation', () => {
  const db = createD1();
  const put = (name, at) => db.sqlite.prepare(catalogUpsertSql(1)).run(...catalogRowParams({ ticker: 'AAA', name }, 'src', at));
  put('Alpha Ltd', '2026-10-01T05:00:00Z');
  put('Alpha Limited', '2026-10-02T05:00:00Z');
  put('Stale Name', '2026-09-01T05:00:00Z');
  const row = db.sqlite.prepare("SELECT name,first_seen_at,last_seen_at,security_type FROM security_catalog WHERE ticker='AAA'").get();
  assert.equal(row.name, 'Alpha Limited');
  assert.equal(row.first_seen_at, '2026-10-01T05:00:00Z');
  assert.equal(row.security_type, null, 'no type is guessed');
});
test('a full batch stays under the D1 parameter limit', () => {
  assert.ok(CATALOG_CHUNK * 5 <= 100);
});
test('only placeholder names are filled; user and facts names survive', async () => {
  const db = createD1();
  db.sqlite.prepare(catalogUpsertSql(2)).run(...catalogRowParams({ ticker: 'AAA', name: 'Alpha Ltd' }, 's', 'x'), ...catalogRowParams({ ticker: 'BBB', name: 'Beta Ltd' }, 's', 'x'));
  const companies = [{ ticker: 'AAA', name: 'AAA' }, { ticker: 'BBB', name: 'My Beta' }, { ticker: 'CCC', name: 'CCC' }];
  applyCatalog(companies, await readCatalog(db, ['AAA', 'BBB', 'CCC']));
  assert.deepEqual(companies.map((c) => c.name), ['Alpha Ltd', 'My Beta', 'CCC']);
});

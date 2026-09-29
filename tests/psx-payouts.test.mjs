import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePayouts, parseDetails, parseBookClosure, parseAnnouncedOn } from '../lib/psx-payouts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'psx-mebl-payouts.html'), 'utf8');

test('parses the live MEBL payouts fragment', () => {
  const rows = parsePayouts(fixture, 'MEBL');
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], {
    ticker: 'MEBL',
    announcedOn: '2026-08-06',
    period: '30/06/2026(HYR)',
    details: '80(ii) (D)',
    kind: 'cash',
    percent: 80,
    perShareRs: null,
    bookClosureStart: '2026-08-19',
    bookClosureEnd: '2026-08-20',
  });
  assert.equal(rows[2].percent, 70);
  assert.equal(rows[2].bookClosureStart, '2026-03-25');
  assert.ok(rows.every((r) => r.kind === 'cash'));
});

test('parses detail variants', () => {
  assert.deepEqual(parseDetails('250%(F) (D)'), [{ kind: 'cash', percent: 250, perShareRs: null }]);
  assert.deepEqual(parseDetails('0.85% (F) (D)'), [{ kind: 'cash', percent: 0.85, perShareRs: null }]);
  assert.deepEqual(parseDetails('Rs.5 (D)'), [{ kind: 'cash', percent: null, perShareRs: 5 }]);
  assert.deepEqual(parseDetails('25%(F) (D) 10%(B)'), [
    { kind: 'cash', percent: 25, perShareRs: null },
    { kind: 'bonus', percent: 10, perShareRs: null },
  ]);
  assert.deepEqual(parseDetails('20%(R)'), [{ kind: 'right', percent: 20, perShareRs: null }]);
  assert.deepEqual(parseDetails('no payout'), []);
});

test('parses dates and rejects garbage', () => {
  assert.equal(parseAnnouncedOn('February 9, 2026 3:36 PM'), '2026-02-09');
  assert.equal(parseAnnouncedOn('Smarch 9, 2026'), null);
  assert.deepEqual(parseBookClosure('06/05/2026  - 07/05/2026 '), { start: '2026-05-06', end: '2026-05-07' });
  assert.equal(parseBookClosure('31/02/2026'), null);
  assert.equal(parseBookClosure('-'), null);
  assert.deepEqual(parsePayouts('<html>Not Found</html>', 'X'), []);
});

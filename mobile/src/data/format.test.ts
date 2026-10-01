import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthTitle, pktTime, plural, shortDate, signedMoney, signedPercent } from './format.ts';

test('signed money uses a true minus and no sign at zero', () => {
  assert.match(signedMoney(1200), /^\+.*1,200/);
  assert.match(signedMoney(-300), /^−.*300/);
  assert.doesNotMatch(signedMoney(0), /[+−]/);
  assert.equal(signedMoney(null), '—');
});

test('signed percent', () => {
  assert.equal(signedPercent(12.934), '+12.93%');
  assert.equal(signedPercent(-6.9), '−6.90%');
  assert.equal(signedPercent(0), '0.00%');
  assert.equal(signedPercent(null), '—');
});

test('short dates drop the year only for the current one', () => {
  assert.equal(shortDate('2026-09-30', 2026), '30 Sep');
  assert.equal(shortDate('2025-12-01', 2026), '1 Dec 2025');
  assert.equal(shortDate('2026-09-30'), '30 Sep');
  assert.equal(shortDate(null), '—');
  assert.equal(shortDate('bad'), '—');
});

test('pakistan time and month titles', () => {
  assert.equal(pktTime('2026-10-01T09:05:00Z'), '14:05');
  assert.equal(pktTime('2026-10-01T22:30:00Z'), '03:30');
  assert.equal(pktTime('nope'), null);
  assert.equal(pktTime(null), null);
  assert.equal(monthTitle('2026-10'), 'October 2026');
  assert.equal(monthTitle('2026-10', false), 'October');
  assert.equal(plural(1, 'buy'), '1 buy');
  assert.equal(plural(2, 'company', 'companies'), '2 companies');
});

test('chart summary says direction, amount and range', async () => {
  const { changeSummary } = await import('./format.ts');
  const { money } = await import('../../../lib/portfolio.ts');
  // money() follows the runtime's ICU data for PKR decimals (Rs 12.3 vs Rs 12.30), so compare against it.
  assert.equal(changeSummary({ change: 12.3, percent: 4.2 }, 'one month'), `Up ${money(12.3)} (+4.20%) over one month`);
  assert.equal(changeSummary({ change: -5, percent: -2 }, 'one week'), `Down ${money(5)} (−2.00%) over one week`);
  assert.equal(changeSummary({ change: 0, percent: 0 }, 'one day'), 'Unchanged over one day');
  assert.equal(changeSummary(null, 'one day'), null);
});

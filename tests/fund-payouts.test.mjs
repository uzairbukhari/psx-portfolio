import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMufapPayouts } from '../lib/mufap.ts';

const row = (id, name, per, ex, date) =>
  `<tr><td>Open-End Funds</td><td>UBL Fund Managers Limited</td><td><a href="/FundProfile/FundDetail?FundID=${id}">${name}</a></td><td>Shariah Compliant Money Market</td><td>Sep 20, 2013</td><td>${per}</td><td>${ex}</td><td>${date}</td></tr>`;

test('reads payout per unit, ex-NAV and date keyed by the fund id', () => {
  const html = `<table><tr><th>Sector</th></tr>${row('13146', 'Al Ameen Islamic Cash Fund', '9.3', '101.2', 'Jun 29, 2026')}${row('1', 'ABL Cash Fund', '1,000.5', '10.2552', 'Jun 29, 2026')}</table>`;
  assert.deepEqual(parseMufapPayouts(html), [
    { mufapId: '13146', payoutDate: '2026-06-29', perUnit: 9.3, exNav: 101.2 },
    { mufapId: '1', payoutDate: '2026-06-29', perUnit: 1000.5, exNav: 10.2552 },
  ]);
});

test('skips rows without a fund link, a real date or positive amounts, and duplicates', () => {
  const html = `<table>
    <tr><td>a</td><td>b</td><td>No link</td><td>c</td><td>d</td><td>1</td><td>2</td><td>Jun 29, 2026</td></tr>
    ${row('2', 'Bad date', '1', '2', 'soon')}
    ${row('3', 'Zero', '0', '2', 'Jun 29, 2026')}
    ${row('4', 'Good', '1', '2', 'Jun 29, 2026')}
    ${row('4', 'Good again', '1', '2', 'Jun 29, 2026')}
  </table>`;
  assert.deepEqual(
    parseMufapPayouts(html).map((p) => p.mufapId),
    ['4'],
  );
});

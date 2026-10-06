import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePakQatarNavs } from '../lib/plan-navs.ts';

const PAGE = `<table><thead><tr><th>Date</th><th>Aggressive</th></tr></thead><tbody>
<tr><td>Friday, October 02, 2026</td><td>2873.2805</td><td>2076.5970</td><td>2790.6203</td><td>2065.8805</td><td>884.7768</td><td>774.6321</td><td>566.5211</td><td>567.7007</td><td>591.8227</td></tr>
<tr><td>Thursday, October 01, 2026</td><td>2870.0000</td><td>2070.0000</td><td>2790.0000</td><td>2065.0000</td><td>884.0000</td><td>774.0000</td><td>566.0000</td><td>567.0000</td></tr>
</tbody></table>`;

test('Pak-Qatar price rows are read column by column; a row missing a price is skipped', () => {
  const rows = parsePakQatarNavs(PAGE);
  assert.equal(rows.length, 9);
  assert.deepEqual(
    rows.find((r) => r.fundId === 'pure-saving'),
    { fundId: 'pure-saving', date: '2026-10-02', nav: 884.7768 },
  );
  assert.equal(rows.find((r) => r.fundId === 'aggressive').nav, 2873.2805);
  assert.equal(rows.find((r) => r.fundId === 'prosperity').nav, 591.8227);
});

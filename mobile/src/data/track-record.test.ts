import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, type Portfolio } from '../../../lib/portfolio.ts';
import { benchmarkView, buildTrackRecord, historyBatches, returnView, sliceByRange, valueChartView } from './track-record.ts';

const sec = (date: string) => Date.parse(`${date}T12:00:00+05:00`) / 1000;
const co = (ticker: string) => ({ ticker, name: ticker, sector: 'Bank' as const, target: 0, approved: true, screenDate: '2025-01-01', note: '' });

function sample(): Portfolio {
  const p = blankPortfolio();
  p.companies = [co('AAA')];
  p.trades = [
    { id: '1', ticker: 'AAA', kind: 'buy', date: '2025-01-02', shares: 10, price: 100, fees: 0, month: '2025-01', note: '' },
    { id: '2', ticker: 'AAA', kind: 'buy', date: '2025-07-01', shares: 10, price: 110, fees: 0, month: '2025-07', note: '' },
  ];
  return p;
}
const aaa = [[sec('2025-01-02'), 100], [sec('2025-07-01'), 110], [sec('2026-01-02'), 130]];
const kse = [[sec('2025-01-02'), 1000], [sec('2025-07-01'), 1100], [sec('2026-01-02'), 1250]];

test('history batches stay under the endpoint limit and put the index first', () => {
  const tickers = Array.from({ length: 130 }, (_, i) => `T${i + 10}`);
  const b = historyBatches(tickers);
  assert.ok(b.every((x) => x.length <= 60));
  assert.equal(b[0][0], 'KSE100');
  assert.equal(b.flat().filter((t) => t !== 'KSE100').length, 130);
  assert.deepEqual(historyBatches([]), [['KSE100']]);
});

test('range slicing keeps the last 1M/6M/1Y or everything', () => {
  const pts = Array.from({ length: 400 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10) }));
  assert.equal(sliceByRange(pts, 'all').length, 400);
  assert.equal(sliceByRange(pts, '1m').length, 32);
  assert.ok(sliceByRange(pts, '6m').length > 180 && sliceByRange(pts, '6m').length < 190);
  assert.equal(sliceByRange(pts, '1y').length, 367);
});

test('track record ties the three pieces together and states what it left out', () => {
  const p = sample();
  const rec = buildTrackRecord({ portfolio: p, histories: { AAA: aaa, KSE100: kse }, asOf: '2026-01-02', currentValue: 2600, missingPrice: [] });
  assert.equal(rec.block, null);
  assert.equal(rec.value.points.at(-1)?.moneyIn, 2100);
  assert.equal(rec.mwr.reason, 'ok');
  assert.equal(rec.benchmark.available, true);
  const chart = valueChartView(rec.value, 'all', 2026);
  assert.equal(chart.kind, 'chart');
  if (chart.kind === 'chart') {
    assert.match(chart.summary, /Value (PKR|Rs)\s?2,600.* against (PKR|Rs)\s?2,100.* put in: \+(PKR|Rs)\s?500/);
    assert.match(chart.spoken, /gain of (PKR|Rs)\s?500/);
    assert.match(chart.spoken, /Dividends are not counted/);
    assert.equal(chart.value.length, chart.moneyIn.length);
  }
  const bv = benchmarkView(rec.benchmark, 'all', 2026, rec.benchmarkBlock);
  assert.equal(bv.kind, 'chart');
  if (bv.kind === 'chart') {
    assert.match(bv.legend, /price index \(dividends excluded\), same cash flows/);
    assert.ok(bv.yours.headline && bv.index.headline);
    assert.deepEqual(bv.notes, []);
  }
});

test('missing price or unknown cost withholds the return and the comparison', () => {
  const p = sample();
  const missing = buildTrackRecord({ portfolio: p, histories: { AAA: aaa, KSE100: kse }, asOf: '2026-01-02', currentValue: null, missingPrice: ['AAA'] });
  assert.match(missing.block ?? '', /Needs a price for AAA/);
  assert.equal(returnView(missing.mwr, missing.block).headline, null);
  const bv = benchmarkView(missing.benchmark, 'all', 2026, missing.benchmarkBlock);
  assert.equal(bv.kind, 'unavailable');

  p.trades.push({ id: 'o', ticker: 'BBB', kind: 'opening', date: '2024-12-01', shares: 5, price: null, fees: 0, month: '2024-12', note: '' });
  p.companies.push(co('BBB'));
  const unknown = buildTrackRecord({ portfolio: p, histories: { AAA: aaa, KSE100: kse }, asOf: '2026-01-02', currentValue: 2600, missingPrice: [] });
  assert.match(unknown.block ?? '', /cost of BBB/);
  const chart = valueChartView(unknown.value, 'all', 2026);
  assert.ok(chart.kind === 'chart' ? chart.notes.some((n) => /BBB/.test(n)) : /BBB/.test(chart.reason));
});

test('no index history draws no benchmark and says so; a short life gives no yearly rate', () => {
  const p = sample();
  const rec = buildTrackRecord({ portfolio: p, histories: { AAA: aaa }, asOf: '2026-01-02', currentValue: 2600, missingPrice: [] });
  const bv = benchmarkView(rec.benchmark, 'all', 2026, rec.benchmarkBlock);
  assert.equal(bv.kind, 'unavailable');
  assert.match(bv.kind === 'unavailable' ? bv.reason : '', /not been collected yet/);
  const short = buildTrackRecord({ portfolio: p, histories: {}, asOf: '2025-02-01', currentValue: 1100, missingPrice: [] });
  assert.match(returnView(short.mwr, short.block).note ?? '', /at least 90 days/);
});

test('index history that starts after the first entry says so', () => {
  const p = sample();
  const late = kse.slice(1);
  const rec = buildTrackRecord({ portfolio: p, histories: { AAA: aaa, KSE100: late }, asOf: '2026-01-02', currentValue: 2600, missingPrice: [] });
  const bv = benchmarkView(rec.benchmark, 'all', 2026, rec.benchmarkBlock);
  assert.equal(bv.kind, 'chart');
  if (bv.kind === 'chart') assert.match(bv.notes.join(' '), /starts on 1 Jul.*later than your first entry \(2 Jan 2025\)/);
});

test('a holding with no price history keeps the chart honest and blocks the comparison', () => {
  const p = sample();
  p.companies.push(co('CCC'));
  p.trades.push({ id: 'c', ticker: 'CCC', kind: 'buy', date: '2025-03-01', shares: 1, price: 50, fees: 0, month: '2025-03', note: '' });
  const rec = buildTrackRecord({ portfolio: p, histories: { AAA: aaa, KSE100: kse }, asOf: '2026-01-02', currentValue: 2700, missingPrice: [] });
  assert.match(rec.benchmarkBlock ?? '', /CCC/);
  const chart = valueChartView(rec.value, 'all', 2026);
  assert.ok(chart.kind === 'chart' && chart.notes.some((n) => /No price history yet for CCC/.test(n)));
});

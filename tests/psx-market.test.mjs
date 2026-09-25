import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseIndexSummary,
  parseTopMovers,
  parseSectorPerformance,
  parseMarketWatch,
  pakistanMarketState,
  selectShortlistPerformance,
  downsample,
} from '../lib/psx-market.ts';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parseIndexSummary reads price, change and stats from the PSX homepage markup', () => {
  const summary = parseIndexSummary(fixture('psx-indices.html'), 'KSE100');
  assert.equal(summary.close, 169043.19);
  assert.equal(summary.change, 1021.39);
  assert.equal(summary.changePercent, 0.61);
  assert.equal(summary.date, '2026-09-17');
  assert.equal(summary.high, 169576.52);
  assert.equal(summary.low, 168222.91);
  assert.equal(summary.previousClose, 168021.8);
  assert.equal(summary.ytdChangePercent, -2.88);
  assert.equal(summary.dayRangeLow, 168222.91);
  assert.equal(summary.weekRangeHigh, 191032.7344);
});

test('parseIndexSummary throws on an unknown index name', () => {
  assert.throws(() => parseIndexSummary(fixture('psx-indices.html'), 'NOPE'));
});

test('parseTopMovers groups rows under active/advancers/decliners', () => {
  const movers = parseTopMovers(fixture('psx-performers.html'));
  assert.ok(movers.active.length > 0);
  assert.ok(movers.advancers.length > 0);
  assert.ok(movers.decliners.length > 0);
  const mdtl = movers.active.find((m) => m.symbol === 'MDTL');
  assert.ok(mdtl);
  assert.equal(mdtl.price, 7.6);
  assert.equal(mdtl.change, -0.05);
  assert.equal(mdtl.changePercent, -0.65);
  assert.equal(mdtl.volume, 42158741);
});

test('parseSectorPerformance averages percent change per sector code', () => {
  const sectors = parseSectorPerformance(fixture('psx-market-watch.html'));
  const oilAndGas = sectors.find((s) => s.sector === 'Oil & Gas Exploration Companies');
  assert.ok(oilAndGas);
  assert.equal(oilAndGas.companyCount, 2);
  assert.equal(oilAndGas.changePercent, Math.round(((1.529 + 0.952) / 2) * 100) / 100);
  const fertilizer = sectors.find((s) => s.sector === 'Fertilizer');
  assert.equal(fertilizer.companyCount, 1);
  assert.equal(fertilizer.changePercent, -0.14);
});

test('parseMarketWatch reads positive and negative company performance', () => {
  const quotes = parseMarketWatch(
    fixture('psx-market-watch.html'),
    '2026-09-25T05:00:00.000Z',
  );
  const mari = quotes.find((quote) => quote.symbol === 'MARI');
  const ffc = quotes.find((quote) => quote.symbol === 'FFC');
  assert.deepEqual(
    { price: mari.price, change: mari.change, percent: mari.changePercent, high: mari.high, low: mari.low },
    { price: 650.22, change: 9.79, percent: 1.529, high: 653.97, low: 638.99 },
  );
  assert.equal(ffc.change, -0.75);
  assert.equal(ffc.volume, 494913);
  assert.equal(mari.sourceTimestamp, null);
  assert.equal(mari.retrievedAt, '2026-09-25T05:00:00.000Z');
});

test('parseMarketWatch rejects malformed markup and skips malformed rows', () => {
  assert.throws(() => parseMarketWatch('<table><tr><td>broken</td></tr></table>'));
  const html = fixture('psx-market-watch.html').replace(
    'data-order="650.22"',
    'data-order="not-a-price"',
  );
  assert.equal(parseMarketWatch(html).some((quote) => quote.symbol === 'MARI'), false);
});

test('shortlist performance preserves user order and represents unavailable values', () => {
  const quotes = parseMarketWatch(fixture('psx-market-watch.html'));
  const firstUser = selectShortlistPerformance(
    ['FFC', 'MARI', 'MISSING'],
    [
      { ticker: 'MARI', name: 'Mari Energies' },
      { ticker: 'FFC', name: 'Fauji Fertilizer' },
      { ticker: 'MISSING', name: 'Missing Company' },
    ],
    quotes,
  );
  const secondUser = selectShortlistPerformance(
    ['OGDC'],
    [{ ticker: 'OGDC', name: 'Oil & Gas Development Company' }],
    quotes,
  );
  assert.deepEqual(firstUser.map((quote) => quote.ticker), ['FFC', 'MARI', 'MISSING']);
  assert.equal(firstUser[0].change < 0, true);
  assert.equal(firstUser[1].change > 0, true);
  assert.equal(firstUser[2].price, null);
  assert.deepEqual(secondUser.map((quote) => quote.ticker), ['OGDC']);
  assert.deepEqual(selectShortlistPerformance([], [], quotes), []);
});

test('shortlist fallback supplies only the price and leaves movement unavailable', () => {
  const [quote] = selectShortlistPerformance(
    ['SYS'],
    [{ ticker: 'SYS', name: 'Systems Limited' }],
    [],
    { SYS: { price: 151.25, asOf: 'Sep 24, 2026', fetchedAt: '2026-09-24T11:00:00Z' } },
  );
  assert.equal(quote.price, 151.25);
  assert.equal(quote.change, null);
  assert.equal(quote.high, null);
  assert.equal(quote.sourceTimestamp, 'Sep 24, 2026');
});

test('Pakistan market schedule covers weekdays and the Friday break', () => {
  assert.equal(pakistanMarketState(new Date('2026-09-21T04:32:00Z')).isOpen, true);
  assert.equal(pakistanMarketState(new Date('2026-09-21T10:30:00Z')).isOpen, false);
  assert.deepEqual(
    pakistanMarketState(new Date('2026-09-25T07:00:00Z')),
    { isOpen: false, label: 'Friday break', estimated: true, timeZone: 'Asia/Karachi' },
  );
  assert.equal(pakistanMarketState(new Date('2026-09-25T09:32:00Z')).isOpen, true);
  assert.equal(pakistanMarketState(new Date('2026-09-26T06:00:00Z')).isOpen, false);
});

test('downsample keeps first/last points and caps length', () => {
  const points = Array.from({ length: 100 }, (_, i) => ({ time: i, value: i }));
  const sampled = downsample(points, 10);
  assert.equal(sampled.length, 10);
  assert.equal(sampled[0].time, 0);
  assert.equal(sampled[9].time, 99);
  assert.equal(downsample(points, 200).length, 100);
});

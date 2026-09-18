import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseIndexSummary,
  parseTopMovers,
  parseSectorPerformance,
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

test('downsample keeps first/last points and caps length', () => {
  const points = Array.from({ length: 100 }, (_, i) => ({ time: i, value: i }));
  const sampled = downsample(points, 10);
  assert.equal(sampled.length, 10);
  assert.equal(sampled[0].time, 0);
  assert.equal(sampled[9].time, 99);
  assert.equal(downsample(points, 200).length, 100);
});

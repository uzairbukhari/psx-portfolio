import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCompanyPage, computeMetrics, quantScore, quantAllocation } from '../lib/company-facts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');
const ASOF = '2026-09-25';

test('parses a non-financial company page (Sales row) with annual, quarterly and ratio tables', () => {
  const facts = parseCompanyPage(fixture('psx-luck.html'), 'LUCK', `${ASOF}T12:00:00Z`);
  assert.equal(facts.name, 'Lucky Cement Limited');
  assert.equal(facts.sector, 'CEMENT');
  assert.equal(facts.price, 416.62);
  assert.equal(facts.priceDate, ASOF);
  assert.equal(facts.peTtm, 13.09);
  assert.deepEqual(facts.week52, { low: 339, high: 529.5 });
  assert.equal(facts.change1y, -10.33);
  assert.equal(facts.annual.length, 4);
  assert.deepEqual(facts.annual[0], { period: '2026', revenue: 136527017, pat: 46629367, eps: 31.83 });
  assert.equal(facts.quarterly.length, 4);
  assert.equal(facts.quarterly[0].period, 'Q3 2026');
  assert.ok(facts.ratios.grossMargin.length === 4);
  assert.equal(facts.ratios.peg[2], -0.85, 'parenthesised ratio values are negative');
  assert.ok(facts.announcements.length > 0);
  assert.ok(facts.announcements.every((a) => a.date && a.title));
});

test('parses a bank company page (Mark-up Earned row, no gross margin) without throwing', () => {
  const facts = parseCompanyPage(fixture('psx-mebl.html'), 'MEBL', `${ASOF}T12:00:00Z`);
  assert.equal(facts.name, 'Meezan Bank Limited');
  assert.equal(facts.annual[0].revenue, 420462297, 'bank revenue comes from Mark-up Earned, not Sales');
  assert.equal(facts.annual[0].eps, 49.54);
  assert.deepEqual(facts.ratios.grossMargin, [], 'banks have no gross margin row');
  assert.equal(facts.ratios.netMargin.length, 4);
});

test('decodes HTML entities (PSX sends &amp; for "&") in name and sector', () => {
  const html = '<div class="section" id="quote"><div class="quote__name">Oil &amp; Gas Development Company Limited</div><div class="quote__sector"><span>OIL &amp; GAS EXPLORATION COMPANIES</span></div></div><div class="quote__close">Rs.100.00</div><div class="quote__date">^ As of Fri, Sep 25, 2026 4:48 PM</div>';
  const facts = parseCompanyPage(html, 'OGDC', `${ASOF}T12:00:00Z`);
  assert.equal(facts.name, 'Oil & Gas Development Company Limited');
  assert.equal(facts.sector, 'OIL & GAS EXPLORATION COMPANIES');
});

test('throws a descriptive error on unrecognised markup instead of returning wrong data', () => {
  assert.throws(() => parseCompanyPage('<html><body>not a PSX page</body></html>', 'ZZZZ'), /Unexpected PSX company markup/);
});

test('computeMetrics never throws on an unavailable company and records the reason as a data gap', () => {
  const metrics = computeMetrics({ ticker: 'ZZZZ', unavailable: 'PSX fetch failed (520)' }, ASOF);
  assert.equal(metrics.peTtm, null);
  assert.equal(metrics.dataGaps.length, 1);
  assert.match(metrics.dataGaps[0], /PSX fetch failed/);
});

test('computeMetrics derives earnings yield, YoY EPS growth and 52-week position', () => {
  const facts = parseCompanyPage(fixture('psx-luck.html'), 'LUCK', `${ASOF}T12:00:00Z`);
  const metrics = computeMetrics(facts, ASOF);
  assert.equal(metrics.earningsYieldPct, Math.round((100 / 13.09) * 100) / 100);
  // PSX lists Q3 2026, Q2, Q1 and Q3 2025 (Q4 is only in the annual table); summing those would mix years.
  assert.equal(metrics.epsTtm, null, 'TTM EPS needs four consecutive quarters');
  assert.ok(metrics.epsYoYPct !== null, 'Q3 2025 is present alongside Q3 2026 so YoY growth is computable');
  assert.ok(metrics.pricePositionPct > 0 && metrics.pricePositionPct < 100);
  assert.equal(metrics.recentAnnouncements.length, 3);
});

test('quantScore ranks a cheaper, faster-growing, higher-momentum company above a peer using only two data points', () => {
  const luck = computeMetrics(parseCompanyPage(fixture('psx-luck.html'), 'LUCK'), ASOF);
  const mebl = computeMetrics(parseCompanyPage(fixture('psx-mebl.html'), 'MEBL'), ASOF);
  const scores = quantScore([luck, mebl]);
  const mebl_ = scores.find((s) => s.ticker === 'MEBL');
  const luck_ = scores.find((s) => s.ticker === 'LUCK');
  assert.ok(mebl_.score > luck_.score, 'MEBL has a higher earnings yield, EPS growth and 1-year price change than LUCK');
  assert.ok(mebl_.score >= 0 && mebl_.score <= 100);
});

test('quantScore never lets an unavailable company outscore a scored one', () => {
  const luck = computeMetrics(parseCompanyPage(fixture('psx-luck.html'), 'LUCK'), ASOF);
  const missing = computeMetrics({ ticker: 'ZZZZ', unavailable: 'timeout' }, ASOF);
  const scores = quantScore([luck, missing]);
  assert.equal(scores.find((s) => s.ticker === 'ZZZZ').score, 0);
});

test('quantScore is deterministic for identical input', () => {
  const luck = computeMetrics(parseCompanyPage(fixture('psx-luck.html'), 'LUCK'), ASOF);
  const mebl = computeMetrics(parseCompanyPage(fixture('psx-mebl.html'), 'MEBL'), ASOF);
  assert.deepEqual(quantScore([luck, mebl]), quantScore([luck, mebl]));
});

test('quantAllocation caps a single strong pick at 35% and leaves the rest as cash', () => {
  const scores = [{ ticker: 'AAA', score: 90, confidence: 'High', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: { unavailable: undefined } }];
  const { picks, unallocatedPct } = quantAllocation(scores);
  assert.deepEqual(picks, [{ ticker: 'AAA', score: 90, allocationPct: 35 }]);
  assert.equal(unallocatedPct, 65);
});

test('quantAllocation water-fills across several picks so allocations plus cash sum to 100', () => {
  const scores = [
    { ticker: 'AAA', score: 90, confidence: 'High', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: {} },
    { ticker: 'BBB', score: 70, confidence: 'Medium', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: {} },
    { ticker: 'CCC', score: 60, confidence: 'Medium', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: {} },
  ];
  const { picks, unallocatedPct } = quantAllocation(scores);
  const total = picks.reduce((sum, p) => sum + p.allocationPct, 0) + unallocatedPct;
  assert.ok(Math.abs(total - 100) < 0.01);
  assert.ok(picks.every((p) => p.allocationPct <= 35 + 1e-9));
});

test('quantAllocation excludes companies below the threshold and unavailable companies', () => {
  const scores = [
    { ticker: 'AAA', score: 90, confidence: 'High', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: {} },
    { ticker: 'WEAK', score: 40, confidence: 'Low', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: {} },
    { ticker: 'ZZZZ', score: 0, confidence: 'Low', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: { unavailable: 'timeout' } },
  ];
  const { picks } = quantAllocation(scores);
  assert.deepEqual(picks.map((p) => p.ticker), ['AAA']);
});

test('quantAllocation returns no picks and 100% cash when nothing meets the threshold', () => {
  const scores = [{ ticker: 'AAA', score: 30, confidence: 'Low', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: {} }];
  const { picks, unallocatedPct } = quantAllocation(scores);
  assert.deepEqual(picks, []);
  assert.equal(unallocatedPct, 100);
});

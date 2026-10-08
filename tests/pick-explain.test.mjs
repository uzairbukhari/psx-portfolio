import test from 'node:test';
import assert from 'node:assert/strict';
import { explainPick, readableTitle } from '../lib/pick-explain.ts';

const pick = (over = {}) => ({
  ticker: 'SAZEW', name: 'Sazgar', allocationPct: 35, confidence: 'High', thesis: 'P/E (TTM) 4.31',
  catalysts: ['Sep 29, 2026: DISSEMINATION OF VIDEO RECORDING OF CORPORATE BRIEFING SESSION (CBS)'],
  risks: ['Automated quantitative ranking — no qualitative or news review is performed.'], sourceUrls: [],
  metrics: { peTtm: 4.31, earningsYieldPct: 23, epsYoYPct: 3.35, change1yPct: -11.51, score: 78.33 }, ...over,
});

test('explains a pick in plain words with tailored risks and readable announcements', () => {
  const e = explainPick(pick(), 1, 3);
  assert.match(e.headline, /first out of 3 companies/);
  assert.ok(e.whyPoints.some((x) => /4\.31 times/.test(x)));
  assert.match(e.summary, /grew 3\.35%/);
  assert.ok(e.risks.some((r) => /falling over the past year/.test(r)));
  assert.ok(e.risks.some((r) => /Cheap shares/.test(r)));
  assert.deepEqual(e.news[0], { date: 'Sep 29, 2026', title: 'Dissemination of video recording of corporate briefing session (cbs)' });
  assert.ok(!/P\/E \(TTM\)|YoY|quant/i.test(e.headline + e.whyPoints.join(' ') + e.changePoints.join(' ')));
});

test('falls back to stored text when a saved run has no metrics, and says when there is no news', () => {
  const e = explainPick(pick({ metrics: undefined, catalysts: [], whySelected: 'Ranked 2 of 3.' }), 2, 3);
  assert.deepEqual(e.whyPoints, ['Ranked 2 of 3.']);
  assert.deepEqual(e.news, []);
  assert.match(e.newsNote, /No recent company announcements/);
  assert.equal(readableTitle('Mixed Case stays'), 'Mixed Case stays');
});

test('the Monthly Picks list is validated; a ticked ticker may be on the list without being a saved company', async () => {
  const { blankPortfolio, validate } = await import('../lib/portfolio.ts');
  const p = blankPortfolio();
  p.monthlyPicksList = [{ ticker: 'MEBL', name: 'Meezan Bank Limited' }, { ticker: 'LUCK', name: 'Lucky Cement' }];
  p.monthlyPicksShortlist = ['LUCK'];
  assert.doesNotThrow(() => validate(p));
  p.monthlyPicksShortlist = ['NOPE'];
  assert.throws(() => validate(p), /shortlist/);
  p.monthlyPicksShortlist = [];
  p.monthlyPicksList = [{ ticker: 'bad ticker', name: 'x' }];
  assert.throws(() => validate(p), /Monthly Picks list/);
  p.monthlyPicksList = [{ ticker: 'MEBL', name: 'a' }, { ticker: 'MEBL', name: 'b' }];
  assert.throws(() => validate(p), /Monthly Picks list/);
});

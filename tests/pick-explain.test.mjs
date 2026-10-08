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
  assert.match(e.whySelected, /first out of 3 companies/);
  assert.match(e.whySelected, /4\.31 times/);
  assert.match(e.summary, /grew 3\.35%/);
  assert.ok(e.risks.some((r) => /falling over the past year/.test(r)));
  assert.ok(e.risks.some((r) => /Cheap shares/.test(r)));
  assert.equal(e.newsAndPlans[0], 'Sep 29, 2026: Dissemination of video recording of corporate briefing session (cbs)');
  assert.ok(!/P\/E \(TTM\)|YoY|quant/i.test(e.whySelected + e.whatWouldChange));
});

test('falls back to stored text when a saved run has no metrics, and says when there is no news', () => {
  const e = explainPick(pick({ metrics: undefined, catalysts: [], whySelected: 'Ranked 2 of 3.' }), 2, 3);
  assert.equal(e.whySelected, 'Ranked 2 of 3.');
  assert.deepEqual(e.newsAndPlans, ['No recent company announcements were found for this pick.']);
  assert.equal(readableTitle('Mixed Case stays'), 'Mixed Case stays');
});

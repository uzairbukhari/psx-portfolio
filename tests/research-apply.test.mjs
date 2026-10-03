import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResearchResult, unappliedJobs } from '../lib/research-apply.ts';
import { sanitizeResearchSettings, settingsFromJob } from '../lib/research-settings.ts';
import { DEFAULT_RESEARCH_SETTINGS, blankPortfolio } from '../lib/portfolio.ts';

const details = {
  scores: [10, 10, 10, 5, 5, 8, 5],
  scenarios: [{ eps: 10, multiple: 5 }, { eps: 12, multiple: 7 }, { eps: 14, multiple: 9 }],
  documents: [{ url: 'https://psx.example/report.pdf' }],
  financials: [{ year: '2025', revenue: 100, profit: 10, eps: 12, debt: null }],
  thesis: 'Thesis', risk: 'Risk', catalyst: 'Catalyst',
};

test('a finished dossier is merged into a copy of the portfolio, adding the company when missing', () => {
  const p = blankPortfolio();
  const next = applyResearchResult(p, { id: 'job1', ticker: 'MEBL', companyName: 'Meezan Bank' }, details);
  assert.equal(p.research?.length ?? 0, 0, 'input untouched');
  assert.equal(next.research[0].ticker, 'MEBL');
  assert.equal(next.research[0].jobId, 'job1');
  assert.equal(next.research[0].fairValue, 84);
  assert.equal(next.research[0].score, 53);
  assert.equal(next.companies.find((c) => c.ticker === 'MEBL').name, 'Meezan Bank');
  const again = applyResearchResult(next, { id: 'job2', ticker: 'MEBL', companyName: 'Meezan Bank' }, details);
  assert.equal(again.research.length, 1);
  assert.equal(again.research[0].jobId, 'job2');
  assert.equal(again.companies.length, 1);
});

test('malformed results are refused rather than saved', () => {
  assert.throws(() => applyResearchResult(blankPortfolio(), { id: 'j', ticker: 'MEBL', companyName: 'x' }, { scores: [] }), /incomplete/);
});

test('each completed job is applied exactly once, newest per ticker', () => {
  let p = applyResearchResult(blankPortfolio(), { id: 'old', ticker: 'MEBL', companyName: 'Meezan' }, details);
  const jobs = [
    { id: 'old', ticker: 'MEBL', status: 'complete', completedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'new', ticker: 'MEBL', status: 'complete', completedAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'run', ticker: 'LUCK', status: 'researching', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'luck', ticker: 'LUCK', status: 'complete', completedAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T01:00:00Z' },
  ];
  assert.deepEqual(unappliedJobs(p, jobs).map((j) => j.id).sort(), ['luck', 'new']);
  p = applyResearchResult(p, { id: 'new', ticker: 'MEBL', companyName: 'Meezan' }, details);
  p = applyResearchResult(p, { id: 'luck', ticker: 'LUCK', companyName: 'Lucky' }, details);
  assert.deepEqual(unappliedJobs(p, jobs), []);
});

test('client-sent AI settings are validated server-side; anything odd falls back to the defaults', () => {
  const good = { model: 'gpt-5-mini', reasoningEffort: 'medium', maxOutputTokens: 30000, budgetUsd: 1, maxAttempts: 2, extra: 'x' };
  assert.deepEqual(sanitizeResearchSettings(good), { model: 'gpt-5-mini', reasoningEffort: 'medium', maxOutputTokens: 30000, budgetUsd: 1, maxAttempts: 2 });
  for (const bad of [null, 'x', {}, { ...good, model: 'gpt-9' }, { ...good, budgetUsd: 500 }, { ...good, budgetUsd: -1 }, { ...good, maxAttempts: 1.5 }, { ...good, maxOutputTokens: 10 }, { ...good, reasoningEffort: 'max' }])
    assert.deepEqual(sanitizeResearchSettings(bad), DEFAULT_RESEARCH_SETTINGS);
  assert.deepEqual(settingsFromJob(null), DEFAULT_RESEARCH_SETTINGS);
  assert.deepEqual(settingsFromJob('{not json'), DEFAULT_RESEARCH_SETTINGS);
  assert.equal(settingsFromJob(JSON.stringify(good)).model, 'gpt-5-mini');
});

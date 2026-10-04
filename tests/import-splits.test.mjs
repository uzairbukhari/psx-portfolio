import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAhlLedgerPlan, planAhlLedgerImport } from '../lib/ahl-reconcile.ts';
import { parseAhlLedgerText } from '../lib/ahl-ledger-pdf.ts';
import { possibleSplits, proposeSplits, splitFromProposal } from '../lib/import-splits.ts';
import { blankPortfolio, holdings, validate } from '../lib/portfolio.ts';
import { buildLedgerPdf, extractLikeBrowser, trade } from './helpers/ahl-ledger-fixture.mjs';

const evidence = [{
  ticker: 'SYS', kind: 'split', oldShares: 1, newShares: 5, effectiveDate: '2025-06-02',
  sourceUrl: 'https://example.test/notice', sourceLabel: 'PSX notice', verification: 'curated', checkedAt: '2026-10-04',
}];
const parse = async (list) => parseAhlLedgerText((await extractLikeBrowser(buildLedgerPdf(list, { rowsPerPage: 8 }).bytes)).text);
const confirmAll = (s) => Object.fromEntries(s.trades.filter((t) => t.dateCertainty === 'inferred').map((t) => [t.identity, { date: t.executionDate }]));
const activityOf = (s) => s.trades.map((t) => ({ ticker: t.ticker, date: t.executionDate, price: t.price }));
const sysStatement = () => parse([
  trade({ voucher: 'CV241202', date: '2024-12-02', side: 'Buy', ticker: 'SYS', shares: 100, price: 400 }),
  trade({ voucher: 'CV250804', date: '2025-08-04', side: 'Sell', ticker: 'SYS', shares: 500, price: 150 }),
]);

test('without the split, the SYS sale looks like it needs an assumed acquisition', async () => {
  const s = await sysStatement();
  const plan = planAhlLedgerImport(blankPortfolio(), s, { resolutions: confirmAll(s) });
  assert.equal(plan.inferred.length, 1);
  assert.equal(plan.inferred[0].shares, 400);
});

test('an accepted 1-for-5 split covers the sale: no assumed acquisition, split stored once', async () => {
  const s = await sysStatement();
  const proposals = proposeSplits(blankPortfolio(), activityOf(s), evidence, '2026-10-04');
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].key, 'split:SYS:2025-06-02:1:5');
  const splits = proposals.map((p, i) => splitFromProposal(p, `s${i}`));
  const plan = planAhlLedgerImport(blankPortfolio(), s, { resolutions: confirmAll(s), splits });
  assert.equal(plan.inferred.length, 0);
  assert.equal(plan.splits.length, 1);
  const next = applyAhlLedgerPlan(blankPortfolio(), plan);
  validate(next);
  assert.equal(next.stockSplits.length, 1);
  assert.equal(next.stockSplits[0].source, 'import');
  assert.equal(holdings(next).find((h) => h.ticker === 'SYS')?.shares ?? 0, 0);
  // the ledger now has it, so nothing is proposed again
  assert.equal(proposeSplits(next, activityOf(s), evidence, '2026-10-04').length, 0);
});

test('no split is proposed when every trade is after it, or when the date is still in the future', async () => {
  const after = [{ ticker: 'SYS', date: '2025-07-01', price: 100 }];
  assert.equal(proposeSplits(blankPortfolio(), after, evidence, '2026-10-04').length, 0);
  assert.equal(proposeSplits(blankPortfolio(), [{ ticker: 'SYS', date: '2024-12-02' }], evidence, '2025-05-01').length, 0);
});

test('a split the user voided on purpose is not proposed again', () => {
  const p = blankPortfolio();
  p.stockSplits = [{ id: 'x', ticker: 'SYS', date: '2025-06-03', oldShares: 1, newShares: 5, note: '', voided: true }];
  assert.equal(proposeSplits(p, [{ ticker: 'SYS', date: '2024-12-02' }], evidence, '2026-10-04').length, 0);
});

test('a 5x price fall with no recorded split is flagged as a possible split, never applied', () => {
  const found = possibleSplits(blankPortfolio(), [
    { ticker: 'ZZZ', date: '2025-05-01', price: 600 },
    { ticker: 'ZZZ', date: '2025-07-01', price: 120 },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].ratio, 5);
  assert.equal(possibleSplits(blankPortfolio(), [
    { ticker: 'ZZZ', date: '2025-05-01', price: 600 },
    { ticker: 'ZZZ', date: '2025-07-01', price: 120 },
  ], [{ ticker: 'ZZZ', date: '2025-06-02' }]).length, 0);
});

test('the split lookup sends only ticker symbols off the device', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../app/use-split-review.ts', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/public-data\?tickers=\$\{encodeURIComponent\(part\.join\(','\)\)\}/);
  assert.doesNotMatch(source, /method:\s*'(POST|PUT)'|body:/);
});

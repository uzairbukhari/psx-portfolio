import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, validate } from '../../../lib/portfolio.ts';
import { applyCdcImport, diffImport, parseJsonFile, previewImport } from './imports.ts';

const company = { ticker: 'AAA', name: 'A', sector: 'Bank', target: 10, approved: true, screenDate: '', note: '' };
const row = (over: Record<string, unknown> = {}) => ({
  dividendStatus: 'PAID',
  eventId: 'ev1',
  securitySymbol: 'AAA',
  paymentDate: '15/09/2026',
  grossDividendAmount: '1,000.00',
  netDividendAmount: '850.00',
  financialYear: '2026',
  ...over,
});

test('parseJsonFile gives a friendly error for non-JSON', () => {
  assert.throws(() => parseJsonFile('not json'), /not valid JSON/);
  assert.deepEqual(parseJsonFile('[1]'), [1]);
});

test('CDC import adds paid dividends once and skips duplicates and unknown tickers', () => {
  const p = blankPortfolio();
  p.companies = [company];
  const first = applyCdcImport(p, [row(), row({ eventId: 'ev2', securitySymbol: 'ZZZ' }), row({ eventId: 'ev3', dividendStatus: 'PENDING' })]);
  assert.ok(first.next);
  validate(first.next);
  assert.equal(first.next.dividends?.length, 1);
  assert.equal(first.next.dividends?.[0].grossAmount, 1000);
  assert.match(first.message, /1 dividend imported/);
  assert.equal(p.dividends?.length ?? 0, 0);
  const again = applyCdcImport(first.next, [row()]);
  assert.equal(again.next, null);
  assert.match(again.message, /1 duplicate/);
});

test('CDC import accepts the {data: []} wrapper and rejects net above gross', () => {
  const p = blankPortfolio();
  p.companies = [company];
  const wrapped = applyCdcImport(p, { data: [row({ netDividendAmount: '2,000' })] });
  assert.equal(wrapped.next, null);
  assert.match(wrapped.message, /1 invalid/);
});

test('import preview counts equal what saving would add', () => {
  const p = blankPortfolio();
  p.companies = [company];
  const preview = previewImport('cdc', p, [row(), row({ eventId: 'ev2', paymentDate: '16/09/2026' }), row({ eventId: 'ev3', securitySymbol: 'ZZZ' })]);
  assert.ok(preview.next);
  assert.equal(preview.counts.dividends, 2);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.counts.trades, 0);
  const saved = preview.next;
  assert.equal((saved.dividends?.length ?? 0) - (p.dividends?.length ?? 0), preview.counts.dividends);
  assert.ok(preview.rows.every((r) => r.ticker === 'AAA' && r.label === 'Dividend'));
  assert.deepEqual(diffImport(p, saved).counts, preview.counts);
});

test('import preview of nothing new has no rows and no saved version', () => {
  const p = blankPortfolio();
  p.companies = [company];
  const preview = previewImport('cdc', p, [row({ securitySymbol: 'ZZZ' })]);
  assert.equal(preview.next, null);
  assert.equal(preview.rows.length, 0);
  assert.deepEqual(preview.counts, { trades: 0, dividends: 0, voided: 0, companies: 0 });
});

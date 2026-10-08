import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePaymentDate, addResolvedHistory, settleEstimatedPayments, undoAutoBatch } from '../lib/dividend-auto.ts';
import { planAutoDividendUpdate } from '../lib/dividend-sync.ts';
import { blankPortfolio, validate, dividendStatus, confirmDividendReceipt } from '../lib/portfolio.ts';

const company = (ticker, extra = {}) => ({ ticker, name: ticker, sector: 'X', target: 0, approved: false, screenDate: '', note: '', ...extra });
const buy = (id, ticker, date, shares) => ({ id, ticker, kind: 'buy', date, shares, price: 100, fees: 0, month: '', note: '' });
const ann = (over = {}) => ({
  ticker: 'AAAA', announcedOn: '2025-02-20', period: '31/12/2024(YR)', details: '2.5 (F) (D)', kind: 'cash', percent: null, perShareRs: 2.5,
  bookClosureStart: '2025-03-20', bookClosureEnd: '2025-03-21', ...over,
});
const ledger = (extra = {}) => {
  const p = blankPortfolio();
  p.companies.push(company('AAAA', extra));
  p.trades.push(buy('b1', 'AAAA', '2025-01-10', 100));
  p.dividendTrackingFrom = '2025-09-01';
  return p;
};
const NOW = '2026-10-08T10:00:00.000Z';

test('the estimated payment date is ten weekdays after book closure ends', () => {
  assert.equal(estimatePaymentDate('2025-03-21'), '2025-04-04'); // Fri + 10 weekdays
  assert.equal(estimatePaymentDate('2025-03-19'), '2025-04-02');
});

test('a past payout with a Rs rate is added as received with an estimated date, and counted in its tax year', () => {
  const p = ledger();
  const added = addResolvedHistory(p, [ann()], {}, '2026-10-08', 'auto-x', NOW);
  assert.equal(added.length, 1);
  const d = p.dividends[0];
  assert.equal(d.status, 'received');
  assert.equal(d.paymentDate, '2025-04-04');
  assert.equal(d.paymentDateEstimated, true);
  assert.equal(d.paymentDateUnknown, undefined);
  assert.equal(d.autoBatch, 'auto-x');
  assert.equal(d.grossAmount, 250);
  assert.doesNotThrow(() => validate(p));
});

test('payouts with an open issue (percent without a face value) are left for review, and a verified face value unlocks them', () => {
  const pct = ann({ details: '20%(F) (D)', percent: 20, perShareRs: null });
  const p = ledger();
  assert.equal(addResolvedHistory(p, [pct], {}, '2026-10-08', 'b', NOW).length, 0);
  const evidence = { AAAA: [{ faceValue: 10, effectiveFrom: '', sourceUrl: 'https://dps.psx.com.pk/x', sourceLabel: 'Found by AI', evidence: 'q', verifiedAt: NOW, status: 'ai' }] };
  const q = ledger();
  assert.equal(addResolvedHistory(q, [pct], evidence, '2026-10-08', 'b', NOW).length, 1);
  assert.equal(q.dividends[0].perShare, 2);
});

test('payouts newer than tracking start are left to the expected-dividend path, and a payment date still in the future waits', () => {
  const p = ledger();
  p.dividendTrackingFrom = '2025-03-01';
  assert.equal(addResolvedHistory(p, [ann()], {}, '2026-10-08', 'b', NOW).length, 0);
  const q = ledger();
  assert.equal(addResolvedHistory(q, [ann()], {}, '2025-03-25', 'b', NOW).length, 0);
});

test('expected automatic dividends become received after the estimated date, and can be voided or edited afterwards', () => {
  const p = ledger();
  p.dividendTrackingFrom = '2025-03-01';
  const early = planAutoDividendUpdate(p, [ann()], NOW, '2025-03-25');
  assert.equal(dividendStatus(early.next.dividends[0]), 'expected');
  const later = planAutoDividendUpdate(early.next, [ann()], NOW, '2026-10-08');
  const d = later.next.dividends[0];
  assert.equal(d.status, 'received');
  assert.equal(d.paymentDate, '2025-04-04');
  assert.equal(d.paymentDateEstimated, true);
  assert.ok(later.notifications.some((n) => n.id.startsWith('auto:')));
  // The user's real date replaces the estimate.
  const fixed = confirmDividendReceipt(d, { paymentDate: '2025-04-10' });
  assert.equal(fixed.paymentDateEstimated, undefined);
  // Voiding keeps it out of every later run.
  d.voided = true;
  assert.equal(planAutoDividendUpdate(later.next, [ann()], NOW, '2026-10-09'), null);
});

test('received dividends with an unknown date get an estimated date, which fixes the missing tax-year gap', () => {
  const p = ledger();
  p.dividends = [{
    id: 'auto-psx:AAAA:2025-03-20:2025-02-20', ticker: 'AAAA', date: '2025-03-20', source: 'auto', status: 'received', paymentDateUnknown: true,
    receiptConfirmedAt: '2025-06-01T00:00:00.000Z', externalId: 'psx:AAAA:2025-03-20:2025-02-20', perShare: 2.5, grossAmount: 250, note: 'n',
  }];
  const r = settleEstimatedPayments(p, [ann()], '2026-10-08', 'b', NOW);
  assert.equal(r.dated.length, 1);
  assert.equal(p.dividends[0].paymentDate, '2025-04-04');
  assert.equal(p.dividends[0].paymentDateUnknown, undefined);
  assert.doesNotThrow(() => validate(p));
});

test('undoing a batch voids exactly what that run added', () => {
  const p = ledger();
  addResolvedHistory(p, [ann()], {}, '2026-10-08', 'auto-x', NOW);
  assert.equal(undoAutoBatch(p, 'other'), 0);
  assert.equal(undoAutoBatch(p, 'auto-x'), 1);
  assert.equal(p.dividends[0].voided, true);
});

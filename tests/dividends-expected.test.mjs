import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validate,
  taxSummary,
  pendingAutoDividends,
  dividendStatus,
  confirmDividendReceipt,
  supersedeAutoWithImports,
  taxYearOf,
} from '../lib/portfolio.ts';

const ASOF = '2026-09-30';
const company = () => ({ ticker: 'MEBL', name: 'Meezan', target: 0, approved: true, screenDate: '', note: '', faceValue: 10 });
const tr = (id, kind, date, shares, price = 100, extra = {}) => ({ id, ticker: 'MEBL', kind, date, shares, price, fees: 0, month: kind === 'buy' ? date.slice(0, 7) : '', note: '', ...extra });
const portfolio = (trades, extra = {}) => ({ companies: [company()], trades, quotes: {}, budgets: {}, taxProfile: { filerStatus: 'filer' }, ...extra });
const ann = (extra = {}) => ({
  ticker: 'MEBL', announcedOn: '2026-08-13', period: '30/06/2026(HYR)', details: '70%(ii) (D)', kind: 'cash',
  percent: 70, perShareRs: null, bookClosureStart: '2026-08-27', bookClosureEnd: '2026-08-28', ...extra,
});
const manual = (id, date, perShare, shares = 100) => ({ id, ticker: 'MEBL', date, source: 'manual', perShare, grossAmount: perShare * shares, note: '' });
const imported = (id, date, gross, net, extra = {}) => ({ id, ticker: 'MEBL', date, source: 'import', grossAmount: gross, netAmount: net, externalId: 'cdc-' + id, note: '', ...extra });

test('statuses: manual and import are received, auto is expected until confirmed, legacy auto is expected', () => {
  assert.equal(dividendStatus({ source: 'manual' }), 'received');
  assert.equal(dividendStatus({ source: 'import' }), 'received');
  assert.equal(dividendStatus({ source: 'auto' }), 'expected');
  assert.equal(dividendStatus({ source: 'auto', status: 'received' }), 'received');
});

test('new auto dividends are expected, with entitlement date, certainty and no payment date', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const [d] = pendingAutoDividends(p, [ann()], ASOF);
  assert.equal(d.status, 'expected');
  assert.equal(d.entitlementDate, '2026-08-26');
  assert.equal(d.entitlementCertain, true);
  assert.equal(d.paymentDate, undefined);
  assert.equal(d.date, '2026-08-27');
});

test('expected dividends are excluded from received income and realized return; received ones count', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  p.dividends = pendingAutoDividends(p, [ann()], ASOF);
  validate(p);
  let t = taxSummary(p);
  assert.equal(t.totalDividendIncomeGross, 0);
  assert.equal(t.totalDividendTax, 0);
  assert.equal(t.netRealizedReturn, 0);
  assert.equal(t.expectedDividends.count, 1);
  assert.equal(t.expectedDividends.grossAmount, 700);
  assert.equal(t.expectedDividends.estimatedTax, 105);
  assert.equal(t.dividends[0].status, 'expected');
  assert.equal(t.dividends[0].taxBasis, 'estimate');

  p.dividends = [confirmDividendReceipt(p.dividends[0], { paymentDate: '2026-09-10' })];
  validate(p);
  t = taxSummary(p);
  assert.equal(t.totalDividendIncomeGross, 700);
  assert.equal(t.totalDividendTax, 105);
  assert.equal(t.expectedDividends.count, 0);
  assert.equal(t.dividends[0].status, 'received');
  assert.equal(p.dividends[0].paymentDate, '2026-09-10');
  assert.equal(p.dividends[0].date, '2026-08-27', 'entitlement/book-closure date is kept apart from the payment date');
});

test('confirming with actual figures keeps the recorded deduction whatever the filer setting', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const [auto] = pendingAutoDividends(p, [ann()], ASOF);
  p.dividends = [confirmDividendReceipt(auto, { paymentDate: '2026-09-10', grossAmount: 690, taxWithheld: 103.5 })];
  validate(p);
  const filer = taxSummary(p).dividends[0];
  assert.equal(filer.taxBasis, 'actual');
  assert.equal(filer.tax, 103.5);
  assert.equal(filer.netAmount, 586.5);
  p.taxProfile = { filerStatus: 'non-filer' };
  const nonFiler = taxSummary(p).dividends[0];
  assert.equal(nonFiler.tax, 103.5, 'historical actual deductions are not recalculated');
  assert.equal(nonFiler.netAmount, 586.5);
});

test('confirmation rejects a bad payment date and an invalid deduction', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const [auto] = pendingAutoDividends(p, [ann()], ASOF);
  assert.throws(() => confirmDividendReceipt(auto, { paymentDate: '2026-13-40' }));
  p.dividends = [confirmDividendReceipt(auto, { paymentDate: '2026-09-10', grossAmount: 100, taxWithheld: 500 })];
  assert.throws(() => validate(p));
});

test('expected amount is recomputed from the ledger, and voiding the ledger does not block saving', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100), tr('2', 'buy', '2026-06-01', 50)]);
  const [auto] = pendingAutoDividends(p, [ann()], ASOF);
  p.dividends = [auto];
  assert.equal(taxSummary(p).dividends[0].grossAmount, 1050);
  p.trades[1].voided = true;
  assert.equal(taxSummary(p).dividends[0].grossAmount, 700, 'frozen grossAmount is not trusted');
  p.trades[0].voided = true;
  validate(p);
  assert.equal(taxSummary(p).dividends[0].grossAmount, 0);
  assert.equal(taxSummary(p).expectedDividends.grossAmount, 0);
});

test('a manual dividend still needs shares on its date', () => {
  const p = portfolio([tr('1', 'buy', '2026-09-01', 10)]);
  p.dividends = [manual('m', '2026-08-01', 7)];
  assert.throws(() => validate(p), /no shares held/);
});

test('two announcements in one window: a manual entry covers only the matching one', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const interim = ann();
  const special = ann({ announcedOn: '2026-08-20', percent: 30, bookClosureStart: '2026-09-03', bookClosureEnd: '2026-09-04' });
  p.dividends = [manual('m', '2026-09-10', 3)]; // matches the 30% (Rs 3) announcement
  const out = pendingAutoDividends(p, [interim, special], ASOF);
  assert.equal(out.length, 1);
  assert.equal(out[0].perShare, 7);
});

test('two announcements in one window with no existing entry both come through', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const out = pendingAutoDividends(p, [ann(), ann({ announcedOn: '2026-08-20', percent: 30, bookClosureStart: '2026-09-03', bookClosureEnd: '2026-09-04' })], ASOF);
  assert.equal(out.length, 2);
});

test('a CDC import for the same payout blocks a second auto entry', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  p.dividends = [imported('c', '2026-09-10', 700, 595)];
  assert.deepEqual(pendingAutoDividends(p, [ann()], ASOF), []);
});

test('validate rejects an active import and an active auto for the same event', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const [auto] = pendingAutoDividends(p, [ann()], ASOF);
  p.dividends = [auto, imported('c', '2026-09-10', 700, 595)];
  assert.throws(() => validate(p), /same payout/);
  p.dividends = [{ ...auto, voided: true }, imported('c', '2026-09-10', 700, 595)];
  validate(p);
  p.dividends = [auto, imported('c', '2026-07-01', 123, 100)];
  validate(p);
});

test('a CDC import supersedes the one matching expected auto dividend', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const [auto] = pendingAutoDividends(p, [ann()], ASOF);
  const existing = [auto];
  const result = supersedeAutoWithImports(p, existing, [imported('c', '2026-09-10', 700, 595)]);
  assert.equal(existing[0].voided, true);
  assert.equal(result.voided.length, 1);
  assert.equal(result.ambiguous.length, 0);
});

test('an ambiguous CDC match is left for review instead of voiding a guess', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const a = pendingAutoDividends(p, [ann(), ann({ announcedOn: '2026-08-20', bookClosureStart: '2026-09-03', bookClosureEnd: '2026-09-04' })], ASOF);
  assert.equal(a.length, 2);
  const existing = [...a];
  const result = supersedeAutoWithImports(p, existing, [imported('c', '2026-09-10', 700, 595)]);
  assert.equal(existing.every((d) => !d.voided), true);
  assert.equal(result.voided.length, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].id, 'c');
});

test('an unrelated later CDC payment does not void an expected dividend', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const [auto] = pendingAutoDividends(p, [ann()], ASOF);
  const existing = [auto];
  const result = supersedeAutoWithImports(p, existing, [imported('c', '2026-09-10', 123, 100)]);
  assert.equal(existing[0].voided, undefined);
  assert.equal(result.voided.length, 0);
  assert.equal(result.ambiguous.length, 0);
});

test('taxYearOf maps a date to the July–June Pakistani tax year', () => {
  assert.equal(taxYearOf('2026-06-30'), '2025-26');
  assert.equal(taxYearOf('2026-07-01'), '2026-27');
  assert.equal(taxYearOf('2026-01-15'), '2025-26');
  assert.equal(taxYearOf('2099-12-31'), '2099-00');
});

const sale = (id, date, shares, price, extra = {}) => tr(id, 'sell', date, shares, price, extra);

test('capital gains tax nets gains and losses within one tax year', () => {
  const p = portfolio([
    tr('b', 'buy', '2025-08-01', 200, 100),
    sale('s1', '2025-09-01', 100, 110), // +1000
    sale('s2', '2025-10-01', 100, 96), // -400
  ]);
  const t = taxSummary(p);
  assert.equal(t.taxYears.length, 1);
  const y = t.taxYears[0];
  assert.equal(y.taxYear, '2025-26');
  assert.equal(y.gains, 1000);
  assert.equal(y.losses, 400);
  assert.equal(y.netTaxableGain, 600);
  assert.equal(y.estimatedTax, 90);
  assert.equal(y.basis, 'estimate');
  assert.equal(t.totalCapitalGainsTax, 90);
  assert.equal(t.sales.reduce((a, s) => a + s.tax, 0), 90);
  assert.equal(t.sales.find((s) => s.tradeId === 's2').tax, 0);
});

test('losses do not offset gains in a different tax year', () => {
  const p = portfolio([
    tr('b', 'buy', '2025-05-01', 200, 100),
    sale('s1', '2025-06-20', 100, 110), // +1000, tax year 2024-25
    sale('s2', '2025-07-02', 100, 50), // -5000, tax year 2025-26
  ]);
  const t = taxSummary(p);
  assert.equal(t.taxYears.length, 2);
  assert.equal(t.totalCapitalGainsTax, 150);
});

test('a net loss year owes nothing', () => {
  const p = portfolio([tr('b', 'buy', '2025-08-01', 100, 100), sale('s', '2025-09-01', 100, 50)]);
  assert.equal(taxSummary(p).totalCapitalGainsTax, 0);
});

test('an actual recorded deduction is kept, labelled actual, and unaffected by the filer setting', () => {
  const p = portfolio([tr('b', 'buy', '2025-08-01', 100, 100), sale('s', '2025-09-01', 100, 110, { taxWithheld: 123.45 })]);
  p.taxProfile = { filerStatus: 'non-filer' };
  const t = taxSummary(p);
  assert.equal(t.sales[0].tax, 123.45);
  assert.equal(t.sales[0].taxBasis, 'actual');
  assert.equal(t.taxYears[0].basis, 'actual');
  assert.equal(t.sales[0].realizedGain, 1000, 'gross gain stays available');
  p.taxProfile = undefined;
  assert.equal(taxSummary(p).sales[0].tax, 123.45);
});

test('validate accepts taxWithheld only on sells and only as a sane amount', () => {
  const ok = portfolio([tr('b', 'buy', '2025-08-01', 100, 100), sale('s', '2025-09-01', 100, 110, { taxWithheld: 50 })]);
  validate(ok);
  for (const bad of [{ taxWithheld: -1 }, { taxWithheld: NaN }, { taxWithheld: 1e12 }]) {
    const p = portfolio([tr('b', 'buy', '2025-08-01', 100, 100), sale('s', '2025-09-01', 100, 110, bad)]);
    assert.throws(() => validate(p));
  }
  const onBuy = portfolio([tr('b', 'buy', '2025-08-01', 100, 100, { taxWithheld: 5 })]);
  assert.throws(() => validate(onBuy));
});

test('unknown cost basis keeps tax unknown and gross proceeds available', () => {
  const p = portfolio([tr('o', 'opening', '2025-08-01', 100, null), sale('s', '2025-09-01', 100, 110)]);
  const t = taxSummary(p);
  assert.equal(t.sales[0].tax, null);
  assert.equal(t.totalCapitalGainsTax, null);
  assert.equal(t.sales[0].proceeds, 11000);
});

import { startDividendTracking } from '../lib/portfolio.ts';

test('expected dividends start from the tracking date: earlier book closures are never created', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  p.dividendTrackingFrom = '2026-08-27';
  const before = ann({ announcedOn: '2026-05-01', bookClosureStart: '2026-05-20', bookClosureEnd: '2026-05-21' });
  const onDay = ann();
  assert.deepEqual(pendingAutoDividends(p, [before], ASOF), []);
  assert.equal(pendingAutoDividends(p, [before, onDay], ASOF).length, 1);
  assert.equal(pendingAutoDividends(p, [onDay], ASOF)[0].date, '2026-08-27');
});

test('without a tracking date nothing is filtered (legacy behaviour)', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  assert.equal(pendingAutoDividends(p, [ann({ announcedOn: '2026-05-01', bookClosureStart: '2026-05-20', bookClosureEnd: '2026-05-21' })], ASOF).length, 1);
});

test('startDividendTracking sets the date once and voids only unconfirmed auto dividends before it', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const oldExpected = pendingAutoDividends(p, [ann({ announcedOn: '2026-05-01', bookClosureStart: '2026-05-20', bookClosureEnd: '2026-05-21' })], ASOF)[0];
  const oldReceived = confirmDividendReceipt(pendingAutoDividends(p, [ann({ announcedOn: '2026-03-01', bookClosureStart: '2026-03-10', bookClosureEnd: '2026-03-11' })], ASOF)[0], { paymentDate: '2026-03-25' });
  const current = pendingAutoDividends(p, [ann()], ASOF)[0];
  p.dividends = [oldExpected, oldReceived, current, manual('m', '2026-02-01', 5)];
  const first = startDividendTracking(p, '2026-08-01');
  assert.equal(p.dividendTrackingFrom, '2026-08-01');
  assert.equal(first.set, true);
  assert.deepEqual(first.voided.map((d) => d.id), [oldExpected.id]);
  assert.equal(p.dividends[0].voided, true);
  assert.equal(p.dividends[1].voided, undefined, 'a confirmed dividend stays');
  assert.equal(p.dividends[2].voided, undefined, 'a book closure after the start stays');
  assert.equal(p.dividends[3].voided, undefined, 'manual entries are never touched');
  validate(p);
  const again = startDividendTracking(p, '2026-09-30');
  assert.equal(again.set, false);
  assert.equal(again.voided.length, 0);
  assert.equal(p.dividendTrackingFrom, '2026-08-01', 'the date never moves once set');
});

test('a voided past expected dividend is not re-created', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  const old = ann({ announcedOn: '2026-05-01', bookClosureStart: '2026-05-20', bookClosureEnd: '2026-05-21' });
  p.dividends = pendingAutoDividends(p, [old], ASOF);
  startDividendTracking(p, '2026-08-01');
  assert.deepEqual(pendingAutoDividends(p, [old], ASOF), []);
});

test('validate rejects a malformed tracking date', () => {
  const p = portfolio([tr('1', 'buy', '2026-01-02', 100)]);
  p.dividendTrackingFrom = 'soon';
  assert.throws(() => validate(p));
});

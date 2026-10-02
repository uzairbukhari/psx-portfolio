import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, confirmDividendReceipt, taxSummary, validate } from '../lib/portfolio.ts';
import { portfolioReport } from '../lib/portfolio-reports.ts';

const base = () => {
  const p = blankPortfolio();
  p.companies.push({ ticker: 'AAAA', name: 'Alpha', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({
    id: 't1', ticker: 'AAAA', kind: 'buy', date: '2025-01-10', shares: 100, price: 10, fees: 5, month: '2025-01',
    note: '', source: 'ahl', externalId: 'ahlpdf:abc:CV1:AAAA:b100:100500:1',
  });
  return p;
};
const auto = (extra = {}) => ({
  id: 'auto-psx:AAAA:2025-03-01:2025-02-01', ticker: 'AAAA', date: '2025-03-01', source: 'auto', status: 'received',
  perShare: 2, grossAmount: 200, externalId: 'psx:AAAA:2025-03-01:2025-02-01', note: '', ...extra,
});

test('legacy ledgers without any new fields still validate', () => {
  const p = base();
  p.dividends = [auto({ status: 'expected' }), { id: 'm', ticker: 'AAAA', date: '2025-03-02', source: 'manual', perShare: 1, grossAmount: 100, note: '' }];
  assert.doesNotThrow(() => validate(p));
});

test('new trade provenance validates and survives a JSON backup round trip', () => {
  const p = base();
  p.trades[0] = {
    ...p.trades[0], settlementDate: '2025-01-14', dateCertainty: 'inferred', statementRef: 'abc:CV1', netCash: 1005,
  };
  p.trades.push({
    id: 't2', ticker: 'AAAA', kind: 'buy', date: '2025-01-09', shares: 10, price: 9, fees: 0, month: '2025-01',
    note: 'Assumed', source: 'ahl', externalId: 'ahl:inferred:AAAA:x',
    inferred: { basis: 'sale-price-fallback', priceSource: 'sale ahlpdf:abc', dateBasis: 'day-before-sale', forSale: 'ahlpdf:abc', label: 'User-requested estimate' },
  });
  validate(p);
  const restored = JSON.parse(JSON.stringify(p));
  validate(restored);
  assert.deepEqual(restored.trades, p.trades);
});

test('bad provenance is rejected', () => {
  for (const patch of [
    { dateCertainty: 'maybe' }, { settlementDate: '2025-13-01' }, { netCash: -1 },
    { inferred: { basis: 'guess', priceSource: 'x', dateBasis: 'listing', forSale: 'y', label: 'z' } },
    { kind: 'sell', inferred: { basis: 'ipo-offer', priceSource: 'x', dateBasis: 'listing', forSale: 'y', label: 'z' } },
  ]) {
    const p = base();
    p.trades[0] = { ...p.trades[0], ...patch };
    assert.throws(() => validate(p), /Invalid transaction/, JSON.stringify(patch));
  }
});

test('received dividend with unknown payment date is valid only when explicitly confirmed', () => {
  const ok = base();
  ok.dividends = [auto({ paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' })];
  assert.doesNotThrow(() => validate(ok));
  // legacy invalid shape stays invalid: received auto without a date and without the confirmation
  const legacy = base();
  legacy.dividends = [auto()];
  assert.throws(() => validate(legacy), /Invalid dividend record/);
  for (const patch of [
    { paymentDate: '2025-03-20', paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' },
    { paymentDateUnknown: false, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' },
    { paymentDateUnknown: true },
    { source: 'manual', externalId: undefined, paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' },
  ]) {
    const p = base();
    p.dividends = [auto(patch)];
    assert.throws(() => validate(p), /Invalid dividend record/, JSON.stringify(patch));
  }
});

test('frozen entitlement basis is validated', () => {
  const entitlement = { shares: 100, perShare: 2, bookClosureEnd: '2025-03-02', details: '20%(F) (D)', announcedOn: '2025-02-01', faceValue: 10, rateSource: 'percent-of-face-value', certain: true };
  const p = base();
  p.dividends = [auto({ paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z', entitlement })];
  assert.doesNotThrow(() => validate(p));
  p.dividends = [auto({ paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z', entitlement: { ...entitlement, shares: 0 } })];
  assert.throws(() => validate(p), /Invalid dividend record/);
});

test('unknown-date receipts count as received income, are reported separately, and invent no tax', () => {
  const p = base();
  p.dividends = [auto({ paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' })];
  validate(p);
  const tax = taxSummary(p);
  assert.equal(tax.totalDividendIncomeGross, 200);
  assert.equal(tax.receivedUnknownPaymentDate.count, 1);
  assert.equal(tax.receivedUnknownPaymentDate.grossAmount, 200);
  assert.equal(tax.dividends[0].paymentDate, undefined);
  assert.equal(tax.dividends[0].taxBasis, 'estimate'); // never presented as an actual deduction
  assert.equal(p.dividends[0].taxWithheld, undefined);
  assert.equal(tax.expectedDividends.count, 0);
});

test('a real payment date replaces the unknown-date confirmation', () => {
  const d = confirmDividendReceipt(
    auto({ paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' }),
    { paymentDate: '2025-03-20' },
  );
  assert.equal(d.paymentDateUnknown, undefined);
  const p = base();
  p.dividends = [d];
  assert.doesNotThrow(() => validate(p));
});

test('reports expose the unknown-payment-date bucket', () => {
  const p = base();
  p.dividends = [auto({ paymentDateUnknown: true, receiptConfirmedAt: '2026-10-02T08:00:00.000Z' })];
  const report = portfolioReport(p);
  assert.equal(report.realized.receivedUnknownPaymentDate.count, 1);
});

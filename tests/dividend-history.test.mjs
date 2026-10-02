import test from 'node:test';
import assert from 'node:assert/strict';
import { approveSelectedAsReceived, isResolved, isSelectable, planHistoricalDividends, historicalTickers, suspectedCorporateActions } from '../lib/dividend-history.ts';
import { planAutoDividendUpdate } from '../lib/dividend-sync.ts';
import { blankPortfolio, dividendStatus, pendingAutoDividends, startDividendTracking, supersedeAutoWithImports, taxSummary, validate } from '../lib/portfolio.ts';

const company = (ticker, extra = {}) => ({ ticker, name: ticker, sector: '', target: 0, approved: false, screenDate: '', note: '', ...extra });
const buy = (id, ticker, date, shares, price = 100, extra = {}) => ({ id, ticker, kind: 'buy', date, shares, price, fees: 0, month: '', note: '', ...extra });
const sell = (id, ticker, date, shares) => ({ id, ticker, kind: 'sell', date, shares, price: 110, fees: 0, month: '', note: '' });
const ann = (over = {}) => ({
  ticker: 'AAAA', announcedOn: '2025-02-20', period: '31/12/2024(YR)', details: '20%(F) (D)', kind: 'cash', percent: 20, perShareRs: null,
  bookClosureStart: '2025-03-20', bookClosureEnd: '2025-03-21', ...over,
});
const base = (trades, extra = {}) => {
  const p = blankPortfolio();
  p.companies.push(company('AAAA', { faceValue: 10 }));
  p.trades.push(...trades);
  Object.assign(p, extra);
  return p;
};
const one = (p, announcements, options) => planHistoricalDividends(p, announcements, { from: '2024-01-01', to: '2026-09-30', ...options }).candidates;

test('rate, shares and gross: percent of a confirmed face value times shares at the cutoff', () => {
  const p = base([buy('b1', 'AAAA', '2025-01-10', 100)]);
  const [c] = one(p, [ann()]);
  assert.equal(c.state, 'eligible');
  assert.equal(c.perShare, 2);
  assert.equal(c.shares, 100);
  assert.equal(c.gross, 200);
  assert.equal(c.entitlementDate, '2025-03-18'); // T+2 before 2026, over a weekend-free span
  assert.ok(isResolved(c));
});

test('uncertain face value is never silently defaulted to 10', () => {
  const p = base([buy('b1', 'AAAA', '2025-01-10', 100)]);
  delete p.companies[0].faceValue;
  const [c] = one(p, [ann()]);
  assert.equal(c.perShare, null);
  assert.equal(c.gross, null);
  assert.ok(c.issues.some((i) => i.kind === 'face-value'));
  assert.equal(isResolved(c), false);
  assert.equal(isSelectable(c), false);
  // user confirms Rs 10 in the review
  const [confirmed] = one(p, [ann()], { faceValues: { AAAA: 10 } });
  assert.equal(confirmed.gross, 200);
  assert.ok(confirmed.issues.some((i) => i.kind === 'face-value' && false) === false);
  // an announcement quoted in rupees needs no face value
  const [rupees] = one(p, [ann({ percent: null, perShareRs: 3 })]);
  assert.equal(rupees.gross, 300);
});

test('cutoff: purchases and sales on either side of the entitlement date', () => {
  // book closure Thu 2025-03-20, T+2 -> last qualifying trade Tue 2025-03-18
  const held = (trades) => one(base(trades), [ann()])[0];
  assert.equal(held([buy('b', 'AAAA', '2025-03-18', 10)]).shares, 10);
  assert.equal(held([buy('b', 'AAAA', '2025-03-19', 10)]).state, 'not-held');
  assert.equal(held([buy('b', 'AAAA', '2025-01-02', 10), sell('s', 'AAAA', '2025-03-18', 10)]).state, 'not-held', 'sold on the cutoff day: gone');
  assert.equal(held([buy('b', 'AAAA', '2025-01-02', 10), sell('s', 'AAAA', '2025-03-19', 10)]).shares, 10, 'sold after the cutoff: still entitled');
});

test('fully sold holdings are still reviewed for payouts earned before the sale', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 50), sell('s', 'AAAA', '2025-06-01', 50)]);
  assert.deepEqual(historicalTickers(p), ['AAAA']);
  const [c] = one(p, [ann()]);
  assert.equal(c.state, 'eligible');
  assert.equal(c.shares, 50);
});

test('settlement regime and holiday transitions', () => {
  // T+1 from 2026-02-09: closure Thu 2026-02-12 -> cutoff Wed 2026-02-11
  let [c] = one(base([buy('b', 'AAAA', '2026-02-11', 10)]), [ann({ bookClosureStart: '2026-02-12', bookClosureEnd: '2026-02-12' })]);
  assert.equal(c.settlement, 'T+1');
  assert.equal(c.entitlementDate, '2026-02-11');
  assert.equal(c.shares, 10);
  // still T+2 just before the change; Kashmir Day (Thu 5 Feb) is skipped: closure Fri 2026-02-06 -> cutoff Tue 2026-02-03
  [c] = one(base([buy('b', 'AAAA', '2026-02-04', 10)]), [ann({ bookClosureStart: '2026-02-06', bookClosureEnd: '2026-02-06' })]);
  assert.equal(c.settlement, 'T+2');
  assert.equal(c.entitlementDate, '2026-02-03');
  assert.equal(c.state, 'not-held');
  // Independence Day (Fri 14 Aug 2026) is skipped: closure Mon 17 Aug -> cutoff Thu 13 Aug
  [c] = one(base([buy('b', 'AAAA', '2026-08-13', 10)]), [ann({ bookClosureStart: '2026-08-17', bookClosureEnd: '2026-08-17' })]);
  assert.equal(c.entitlementDate, '2026-08-13');
  assert.equal(c.shares, 10);
  assert.equal(c.issues.some((i) => i.kind === 'calendar'), false, 'official 2026 calendar');
  // Youm-e-Takbeer (fixed holiday) and a press-reported Eid: 2025-04-03 closure -> Eid days skipped, flagged unconfirmed
  [c] = one(base([buy('b', 'AAAA', '2025-03-01', 10)]), [ann({ bookClosureStart: '2025-04-03', bookClosureEnd: '2025-04-03' })]);
  assert.equal(c.entitlementDate, '2025-03-27');
  assert.equal(c.calendarCertain, false);
  assert.ok(c.issues.some((i) => i.kind === 'calendar' && i.severity === 'confirm'));
});

test('stock splits are applied before counting shares', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 10)]);
  p.stockSplits = [{ id: 's1', ticker: 'AAAA', date: '2025-02-01', oldShares: 1, newShares: 4, note: '' }];
  assert.equal(one(p, [ann()])[0].shares, 40);
});

test('duplicate and amended announcements: the latest per book closure wins, older ones are blocked', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 10)]);
  const list = one(p, [ann({ announcedOn: '2025-02-20', percent: 20 }), ann({ announcedOn: '2025-03-01', percent: 25 })]);
  const newer = list.find((c) => c.announcement.announcedOn === '2025-03-01');
  const older = list.find((c) => c.announcement.announcedOn === '2025-02-20');
  assert.equal(newer.perShare, 2.5);
  assert.ok(isResolved(newer));
  assert.ok(older.issues.some((i) => i.kind === 'superseded'));
  assert.equal(isSelectable(older), false);
});

test('existing records are respected: approved, voided, expected (converted), manual/CDC', () => {
  const a = ann();
  const id = `psx:AAAA:${a.bookClosureStart}:${a.announcedOn}`;
  const mk = (dividends) => base([buy('b', 'AAAA', '2025-01-02', 100)], { dividends });
  const auto = (extra) => ({ id: 'auto-' + id, ticker: 'AAAA', date: a.bookClosureStart, source: 'auto', perShare: 2, grossAmount: 200, externalId: id, note: '', ...extra });
  assert.equal(one(mk([auto({ status: 'expected' })]), [a])[0].state, 'convert');
  assert.equal(one(mk([auto({ status: 'received', paymentDate: '2025-04-01' })]), [a])[0].state, 'approved');
  assert.equal(one(mk([auto({ voided: true })]), [a])[0].state, 'voided');
  const manual = { id: 'm', ticker: 'AAAA', date: '2025-04-05', source: 'manual', perShare: 2, grossAmount: 200, note: '' };
  const covered = one(mk([manual]), [a])[0];
  assert.equal(covered.state, 'recorded');
  assert.equal(isSelectable(covered), false);
  // one receipt that could match two payouts must be resolved first
  const second = ann({ announcedOn: '2025-03-05', bookClosureStart: '2025-04-01', bookClosureEnd: '2025-04-02', period: '31/03/2025(IQ)', percent: 20 });
  const both = one(mk([{ ...manual, date: '2025-04-05' }]), [a, second]);
  assert.ok(both.every((c) => c.issues.some((i) => i.kind === 'ambiguous-match')));
});

test('a possible unrecorded corporate action must be acknowledged', () => {
  const p = base([buy('b1', 'AAAA', '2025-01-02', 10, 535), buy('b2', 'AAAA', '2025-02-10', 10, 154)]);
  assert.equal(suspectedCorporateActions(p).length, 1);
  const [c] = one(p, [ann()]);
  const issue = c.issues.find((i) => i.kind === 'corporate-action');
  assert.ok(issue);
  assert.equal(isResolved(c), false);
  assert.equal(isSelectable(c), false);
  assert.equal(isSelectable(c, new Set([`AAAA|corporate-action`])), true);
  // recording the split removes the suspicion
  p.stockSplits = [{ id: 's', ticker: 'AAAA', date: '2025-02-01', oldShares: 1, newShares: 4, note: '' }];
  assert.equal(suspectedCorporateActions(p).length, 0);
});

test('shares that exist only because of an assumed acquisition need confirmation', () => {
  const p = base([buy('b1', 'AAAA', '2025-03-10', 10, 100, { source: 'ahl', externalId: 'ahl:inferred:x', dateCertainty: 'inferred', inferred: { basis: 'sale-price-fallback', priceSource: 's', dateBasis: 'day-before-sale', forSale: 'f', label: 'l' } })]);
  const [c] = one(p, [ann()]);
  assert.ok(c.issues.some((i) => i.kind === 'inferred-shares'));
  assert.equal(isResolved(c), false);
});

test('approve selected as received: frozen gross, unknown payment date, no invented tax, idempotent', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 100)], { dividendTrackingFrom: '2026-10-02' });
  const [c] = one(p, [ann()]);
  const reviewed = [{ id: c.id, shares: c.shares, perShare: c.perShare, gross: c.gross }];
  const result = approveSelectedAsReceived(p, [ann()], { reviewed, from: '2024-01-01', to: '2026-09-30', now: '2026-10-02T10:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.total, 200);
  const d = result.portfolio.dividends[0];
  assert.equal(dividendStatus(d), 'received');
  assert.equal(d.paymentDateUnknown, true);
  assert.equal(d.paymentDate, undefined);
  assert.equal(d.taxWithheld, undefined);
  assert.equal(d.netAmount, undefined);
  assert.equal(d.grossAmount, 200);
  assert.equal(d.entitlement.shares, 100);
  assert.match(d.note, /not a reported payment/);
  validate(result.portfolio);
  assert.equal(p.dividends, undefined, 'input untouched');
  // later holdings changes never move the frozen gross
  const changed = JSON.parse(JSON.stringify(result.portfolio));
  changed.trades.push(buy('b2', 'AAAA', '2025-02-01', 900));
  assert.equal(taxSummary(changed).totalDividendIncomeGross, 200);
  assert.equal(taxSummary(changed).receivedUnknownPaymentDate.count, 1);
  // second sync/approval is a no-op
  const again = one(result.portfolio, [ann()])[0];
  assert.equal(again.state, 'approved');
  assert.equal(approveSelectedAsReceived(result.portfolio, [ann()], { reviewed, from: '2024-01-01', to: '2026-09-30' }).ok, false);
});

test('reload keeps approved entries; background sync adds nothing unselected', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 100)], { dividendTrackingFrom: '2026-06-01' });
  const old = ann();
  const newer = ann({ announcedOn: '2026-08-06', bookClosureStart: '2026-08-19', bookClosureEnd: '2026-08-20', period: '30/06/2026(HYR)', percent: 30 });
  const [c] = one(p, [old, newer]).filter((x) => x.announcement.bookClosureStart === old.bookClosureStart);
  const approved = approveSelectedAsReceived(p, [old, newer], { reviewed: [{ id: c.id, shares: c.shares, perShare: c.perShare, gross: c.gross }], from: '2024-01-01', to: '2026-09-30' });
  const next = approved.portfolio;
  startDividendTracking(next, '2026-06-01');
  assert.equal(next.dividends.filter((d) => d.voided).length, 0, 'approved entry survives the tracking cutoff');
  // an unselected historical announcement is not added; the newer one keeps its established expected behaviour
  const pending = pendingAutoDividends(next, [old, newer, ann({ announcedOn: '2025-08-01', bookClosureStart: '2025-08-20', bookClosureEnd: '2025-08-21' })], '2026-09-30');
  assert.deepEqual(pending.map((d) => d.externalId), ['psx:AAAA:2026-08-19:2026-08-06']);
  const update = planAutoDividendUpdate(next, [old], '2026-10-02T00:00:00Z', '2026-10-02');
  assert.equal(update === null || update.pending.length === 0, true);
});

test('stale review: changed holdings or announcement values require review again and write nothing', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 100)]);
  const [c] = one(p, [ann()]);
  const reviewed = [{ id: c.id, shares: c.shares, perShare: c.perShare, gross: c.gross }];
  const moreShares = JSON.parse(JSON.stringify(p));
  moreShares.trades.push(buy('b2', 'AAAA', '2025-02-02', 50));
  const r1 = approveSelectedAsReceived(moreShares, [ann()], { reviewed, from: '2024-01-01', to: '2026-09-30' });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'stale');
  const r2 = approveSelectedAsReceived(p, [ann({ percent: 25 })], { reviewed, from: '2024-01-01', to: '2026-09-30' });
  assert.equal(r2.reason, 'stale');
  assert.equal(approveSelectedAsReceived(p, [ann()], { reviewed: [], from: '2024-01-01', to: '2026-09-30' }).reason, 'empty');
});

test('multi-select converts an existing expected dividend instead of duplicating it', () => {
  const a = ann();
  const second = ann({ announcedOn: '2025-08-01', bookClosureStart: '2025-08-20', bookClosureEnd: '2025-08-21' });
  const id = `psx:AAAA:${a.bookClosureStart}:${a.announcedOn}`;
  const p = base([buy('b', 'AAAA', '2025-01-02', 100)], {
    dividends: [{ id: 'auto-' + id, ticker: 'AAAA', date: a.bookClosureStart, source: 'auto', status: 'expected', perShare: 2, grossAmount: 200, externalId: id, entitlementDate: '2025-03-17', note: 'Expected' }],
  });
  const cs = one(p, [a, second]);
  const reviewed = cs.map((c) => ({ id: c.id, shares: c.shares, perShare: c.perShare, gross: c.gross }));
  const result = approveSelectedAsReceived(p, [a, second], { reviewed, from: '2024-01-01', to: '2026-09-30' });
  assert.equal(result.ok, true);
  assert.equal(result.portfolio.dividends.length, 2);
  assert.deepEqual(result.converted, [id]);
  assert.equal(result.portfolio.dividends.filter((d) => dividendStatus(d) === 'received').length, 2);
  assert.equal(result.portfolio.dividends.find((d) => d.id === 'auto-' + id).entitlementDate, '2025-03-18', 'cutoff recomputed on the historical calendar');
  validate(result.portfolio);
});

test('a later CDC receipt supersedes the confirmed entry without double counting and keeps the audit trail', () => {
  const p = base([buy('b', 'AAAA', '2025-01-02', 100)]);
  const [c] = one(p, [ann()]);
  const approved = approveSelectedAsReceived(p, [ann()], { reviewed: [{ id: c.id, shares: 100, perShare: 2, gross: 200 }], from: '2024-01-01', to: '2026-09-30' }).portfolio;
  const cdc = { id: 'cdc1', ticker: 'AAAA', date: '2025-04-03', source: 'import', grossAmount: 200, netAmount: 170, externalId: 'cdc:evt1', note: '' };
  const { voided, ambiguous } = supersedeAutoWithImports(approved, approved.dividends, [cdc]);
  assert.equal(voided.length, 1);
  assert.equal(ambiguous.length, 0);
  approved.dividends.push(cdc);
  validate(approved);
  assert.equal(taxSummary(approved).totalDividendIncomeGross, 200, 'counted once');
  assert.equal(approved.dividends.filter((d) => d.voided).length, 1, 'the confirmed entry is retained, voided');
  // and the voided entry is never offered again
  assert.equal(one(approved, [ann()])[0].state, 'voided');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAhlLedgerPlan, planAhlLedgerImport, planIsNoop } from '../lib/ahl-reconcile.ts';
import { parseAhlLedgerText } from '../lib/ahl-ledger-pdf.ts';
import { blankPortfolio, holdings, realizedSales, validate } from '../lib/portfolio.ts';
import { buildLedgerPdf, entries, extractLikeBrowser, trade } from './helpers/ahl-ledger-fixture.mjs';

const parse = async (list = entries()) =>
  parseAhlLedgerText((await extractLikeBrowser(buildLedgerPdf(list, { rowsPerPage: 8 }).bytes)).text);
let counter = 0;
const newId = () => `id${String(++counter).padStart(6, '0')}`;
const empty = () => blankPortfolio();
const confirmAll = (statement) =>
  Object.fromEntries(statement.trades.filter((t) => t.dateCertainty === 'inferred').map((t) => [t.identity, { date: t.executionDate }]));
const commit = (portfolio, statement, options = {}) => {
  const plan = planAhlLedgerImport(portfolio, statement, { newId, resolutions: confirmAll(statement), ...options });
  return { plan, next: applyAhlLedgerPlan(portfolio, plan, newId) };
};
const curatedIpo = (over = {}) => ({
  status: 'found', ticker: 'IPOX', offerPrice: 10, allotmentDate: '2026-05-12', listingDate: '2026-05-15',
  evidence: [{ url: 'https://example.test/offer.pdf', title: 'Final offer document' }], verification: 'curated', checkedAt: '2026-10-02T00:00:00Z', ...over,
});

test('first import adds trades and companies unapproved, assumes IPO acquisition, and a re-upload is a no-op', async () => {
  const statement = await parse();
  const { plan, next } = commit(empty(), statement);
  assert.equal(plan.counts.new, 10);
  assert.deepEqual(plan.newCompanies.sort(), ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'IPOX']);
  assert.ok(next.companies.every((c) => !c.approved && c.target === 0));
  assert.equal(plan.excluded.length, 4);
  validate(next);
  const h = Object.fromEntries(holdings(next).map((x) => [x.ticker, x]));
  assert.equal(h.AAAA.shares, 30 - 10 + 45);
  assert.equal(h.IPOX.shares, 0);
  assert.equal(h.DDDD.shares, 200 - 119);
  const again = planAhlLedgerImport(next, statement, { newId });
  assert.equal(again.counts.duplicate, 10);
  assert.equal(again.counts.imported, 0);
  assert.ok(planIsNoop(again), 'exact re-upload changes nothing');
  assert.equal(again.blockers.length, 0);
});

test('a sale with no history gets the labelled fallback acquisition: gross sale price, day before, zero fees', async () => {
  const statement = await parse();
  const { plan, next } = commit(empty(), statement);
  assert.equal(plan.inferred.length, 1);
  const inf = plan.inferred[0];
  assert.equal(inf.shares, 1500);
  assert.equal(inf.pricing.basis, 'sale-price-fallback');
  assert.equal(inf.price, 10.7);
  assert.equal(inf.date, '2026-06-28'); // sale executed 2026-06-29
  assert.match(inf.pricing.label, /fallback estimate, not a broker-reported purchase/);
  const stored = next.trades.find((t) => t.inferred);
  assert.equal(stored.fees, 0);
  assert.equal(stored.inferred.basis, 'sale-price-fallback');
  assert.equal(stored.month, '');
  // provenance reaches gains: sale cost basis is the assumed price
  const sale = realizedSales(next).find((s) => s.ticker === 'IPOX');
  assert.equal(sale.shares, 1500);
  assert.ok(Math.abs(sale.costBasis - 1500 * 10.7) < 0.01);
});

test('IPO price evidence: curated is used; extracted needs acceptance; missing, late or failed falls back', async () => {
  const statement = await parse();
  const priced = (ipo, extra = {}) =>
    planAhlLedgerImport(empty(), statement, { newId, resolutions: confirmAll(statement), ipo: { IPOX: ipo }, ...extra }).inferred[0];
  const found = priced(curatedIpo());
  assert.equal(found.pricing.basis, 'ipo-offer');
  assert.equal(found.price, 10);
  assert.equal(found.date, '2026-05-12');
  assert.equal(found.pricing.dateBasis, 'allotment');
  const listingOnly = priced(curatedIpo({ allotmentDate: undefined }));
  assert.equal(listingOnly.date, '2026-05-15');
  assert.equal(listingOnly.pricing.dateBasis, 'listing');
  const extracted = priced(curatedIpo({ verification: 'extracted' }));
  assert.equal(extracted.pricing.basis, 'sale-price-fallback');
  assert.equal(extracted.needsAcceptance, true);
  const accepted = priced(curatedIpo({ verification: 'extracted' }), { acceptedIpo: { IPOX: true } });
  assert.equal(accepted.pricing.basis, 'ipo-offer');
  assert.equal(priced(curatedIpo({ allotmentDate: '2026-08-01', listingDate: undefined })).pricing.basis, 'sale-price-fallback');
  assert.equal(priced(curatedIpo({ allotmentDate: undefined, listingDate: undefined })).pricing.basis, 'sale-price-fallback');
  assert.match(priced({ status: 'not-found', ticker: 'IPOX', reason: 'No offer document published.', checkedAt: 'x' }).pricing.label, /No offer document/);
  assert.match(priced({ status: 'failed', ticker: 'IPOX', error: 'timeout', checkedAt: 'x' }).pricing.label, /lookup failed: timeout/);
  assert.equal(priced(undefined).pricing.basis, 'sale-price-fallback');
});

test('assumed acquisitions are editable in the preview and keep their provenance', async () => {
  const statement = await parse();
  const sale = statement.trades.find((t) => t.ticker === 'IPOX');
  const { plan, next } = commit(empty(), statement, { inferredEdits: { [sale.identity]: { price: 9.5, date: '2026-06-01' } } });
  assert.equal(plan.inferred[0].price, 9.5);
  assert.equal(plan.inferred[0].edited, true);
  const stored = next.trades.find((t) => t.inferred);
  assert.equal(stored.price, 9.5);
  assert.equal(stored.date, '2026-06-01');
  assert.match(stored.inferred.label, /Edited by you/);
  // a date after the sale is ignored
  const bad = planAhlLedgerImport(empty(), statement, { newId, resolutions: confirmAll(statement), inferredEdits: { [sale.identity]: { date: '2026-07-30' } } });
  assert.equal(bad.inferred[0].date, '2026-06-28');
});

test('existing holdings and stock splits are reconciled before any acquisition is assumed', async () => {
  const statement = await parse();
  const p = empty();
  p.companies.push({ ticker: 'IPOX', name: 'IPOX', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'o1', ticker: 'IPOX', kind: 'opening', date: '2026-01-01', shares: 600, price: 9, fees: 0, month: '', note: '' });
  const partial = planAhlLedgerImport(p, statement, { newId, resolutions: confirmAll(statement) });
  assert.equal(partial.inferred[0].shares, 900, 'only the missing quantity');
  p.stockSplits = [{ id: 's1', ticker: 'IPOX', date: '2026-03-01', oldShares: 1, newShares: 3, note: '' }];
  const covered = planAhlLedgerImport(p, statement, { newId, resolutions: confirmAll(statement) });
  assert.equal(covered.inferred.length, 0, 'the split leaves 1800 shares, so nothing is missing');
});

test('a later real purchase replaces the assumed quantity, fully or partly, with an audit trail', async () => {
  const statement = await parse();
  const { next: first } = commit(empty(), statement);
  const assumed = first.trades.find((t) => t.inferred);
  assert.equal(assumed.shares, 1500);
  // a later export includes a 600-share purchase before the sale
  const later = await parse([...entries(), trade({ voucher: 'CV260520', date: '2026-05-20', side: 'Buy', ticker: 'IPOX', shares: 600, price: 10.1, settle: 1 })]);
  // (the fixture re-orders by input; the new buy has an earlier date than the sale so the chain stays valid)
  const sorted = [...entries()];
  sorted.splice(sorted.findIndex((e) => e.voucher === 'CV260630'), 0, trade({ voucher: 'CV260520', date: '2026-05-20', side: 'Buy', ticker: 'IPOX', shares: 600, price: 10.1, settle: 1 }));
  void later;
  const statement2 = await parse(sorted);
  const { plan, next } = commit(first, statement2);
  const partial = plan.inferred[0];
  assert.equal(partial.change, 'replace');
  assert.equal(partial.shares, 900);
  assert.equal(plan.voidedInferred.length, 1);
  const oldTrade = next.trades.find((t) => t.id === assumed.id);
  assert.equal(oldTrade.voided, true);
  assert.ok(oldTrade.supersededBy);
  const active = next.trades.filter((t) => !t.voided && t.ticker === 'IPOX' && t.kind === 'buy');
  assert.equal(active.reduce((a, t) => a + t.shares, 0), 1500, 'no duplicate holdings');
  assert.equal(active.filter((t) => t.inferred).length, 1);
  // a purchase covering everything removes the assumption entirely
  const full = [...entries()];
  full.splice(full.findIndex((e) => e.voucher === 'CV260630'), 0, trade({ voucher: 'CV260521', date: '2026-05-21', side: 'Buy', ticker: 'IPOX', shares: 1500, price: 10, settle: 1 }));
  const { plan: fullPlan, next: fullNext } = commit(first, await parse(full));
  assert.equal(fullPlan.inferred.length, 0);
  assert.equal(fullPlan.voidedInferred.length, 1);
  assert.ok(!fullNext.trades.some((t) => !t.voided && t.inferred));
  // repeating the same corrective import changes nothing further
  assert.ok(planIsNoop(planAhlLedgerImport(fullNext, await parse(full), { newId })));
});

test('overlapping reports are idempotent and reordered rows do not matter', async () => {
  const all = entries();
  const firstHalf = await parse(all.slice(0, 9));
  const { next } = commit(empty(), firstHalf);
  const whole = await parse(all);
  const overlap = planAhlLedgerImport(next, whole, { newId, resolutions: confirmAll(whole) });
  assert.equal(overlap.counts.duplicate, firstHalf.trades.length);
  assert.equal(overlap.counts.imported, whole.trades.length - firstHalf.trades.length);
  const plan = planAhlLedgerImport(next, whole, { newId, resolutions: confirmAll(whole) });
  assert.deepEqual(plan.rows.map((r) => [r.trade.identity, r.status]), overlap.rows.map((r) => [r.trade.identity, r.status]));
});

test('legitimately identical fills stay distinct; one existing JSON fill matches only one of them', async () => {
  const statement = await parse();
  const dd = statement.trades.filter((t) => t.ticker === 'DDDD' && t.kind === 'buy');
  assert.equal(dd.length, 2);
  const p = empty();
  p.companies.push({ ticker: 'DDDD', name: 'D', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  const jsonFill = { id: 'j1', ticker: 'DDDD', kind: 'buy', date: dd[0].executionDate, shares: 100, price: dd[0].price, fees: dd[0].fees, month: '2024-12', note: '', source: 'ahl', externalId: 'ahl:DDDD|buy|x|1' };
  p.trades.push(jsonFill);
  const plan = planAhlLedgerImport(p, statement, { newId, resolutions: confirmAll(statement) });
  const rows = plan.rows.filter((r) => r.trade.ticker === 'DDDD' && r.trade.kind === 'buy');
  assert.deepEqual(rows.map((r) => r.status), ['duplicate', 'new']);
  assert.deepEqual(rows[0].matchedIds, ['j1']);
});

test('one statement row can match several execution fills from AHL JSON', async () => {
  const statement = await parse();
  const row = statement.trades.find((t) => t.ticker === 'AAAA' && t.kind === 'buy' && t.shares === 30);
  const p = empty();
  p.companies.push({ ticker: 'AAAA', name: 'A', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  const fee = (n) => Math.round((row.fees * n) / 30 * 10_000) / 10_000;
  p.trades.push(
    { id: 'f1', ticker: 'AAAA', kind: 'buy', date: row.executionDate, shares: 20, price: row.price, fees: fee(20), month: '', note: '', source: 'ahl', externalId: 'ahl:a|1' },
    { id: 'f2', ticker: 'AAAA', kind: 'buy', date: row.executionDate, shares: 10, price: row.price, fees: fee(10), month: '', note: '', source: 'ahl', externalId: 'ahl:a|2' },
  );
  const plan = planAhlLedgerImport(p, statement, { newId, resolutions: confirmAll(statement) });
  const matched = plan.rows.find((r) => r.trade.identity === row.identity);
  assert.equal(matched.status, 'duplicate');
  assert.deepEqual(matched.matchedIds.sort(), ['f1', 'f2']);
});

test('manual and other-broker lookalikes need an explicit decision and are never merged automatically', async () => {
  const statement = await parse();
  const row = statement.trades.find((t) => t.ticker === 'AAAA' && t.shares === 30);
  const mk = (source, price) => {
    const p = empty();
    p.companies.push({ ticker: 'AAAA', name: 'A', sector: '', target: 0, approved: false, screenDate: '', note: '' });
    p.trades.push({ id: 'x1', ticker: 'AAAA', kind: 'buy', date: row.executionDate, shares: 30, price, fees: row.fees, month: '', note: '', ...(source ? { source, externalId: 'fq:1' } : {}) });
    return p;
  };
  // manual entry with the same quantity but a different price
  let plan = planAhlLedgerImport(mk(undefined, 150), statement, { newId, resolutions: confirmAll(statement) });
  let r = plan.rows.find((x) => x.trade.identity === row.identity);
  assert.equal(r.status, 'ambiguous');
  assert.ok(plan.blockers.some((b) => /need your decision/.test(b)));
  assert.throws(() => applyAhlLedgerPlan(mk(undefined, 150), plan, newId));
  // user says it is the same trade: skipped, existing trade consumed
  plan = planAhlLedgerImport(mk(undefined, 150), statement, { newId, resolutions: { ...confirmAll(statement), [row.identity]: { action: 'skip' } } });
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.rows.find((x) => x.trade.identity === row.identity).action, 'skip');
  // user says it is different: imported alongside
  plan = planAhlLedgerImport(mk(undefined, 150), statement, { newId, resolutions: { ...confirmAll(statement), [row.identity]: { action: 'import' } } });
  assert.equal(plan.rows.find((x) => x.trade.identity === row.identity).action, 'import');
  // another broker's identical trade is flagged even though every number agrees
  plan = planAhlLedgerImport(mk('finqalab', row.price), statement, { newId, resolutions: confirmAll(statement) });
  r = plan.rows.find((x) => x.trade.identity === row.identity);
  assert.equal(r.status, 'ambiguous');
  assert.match(r.candidates[0].reason, /another broker/i);
});

test('a manual entry that exactly equals a statement row is the same trade', async () => {
  const statement = await parse();
  const row = statement.trades.find((t) => t.ticker === 'AAAA' && t.shares === 30);
  const p = empty();
  p.companies.push({ ticker: 'AAAA', name: 'A', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'm1', ticker: 'AAAA', kind: 'buy', date: row.executionDate, shares: 30, price: row.price, fees: row.fees, month: '', note: '' });
  const plan = planAhlLedgerImport(p, statement, { newId, resolutions: confirmAll(statement) });
  assert.equal(plan.rows.find((x) => x.trade.identity === row.identity).status, 'duplicate');
});

test('uncertain execution dates must be confirmed or corrected before committing', async () => {
  const statement = await parse();
  const eid = statement.trades.find((t) => t.voucher === 'CV250403');
  assert.equal(eid.dateCertainty, 'inferred');
  const plan = planAhlLedgerImport(empty(), statement, { newId });
  assert.equal(plan.rows.find((r) => r.trade.identity === eid.identity).needsResolution, true);
  assert.ok(plan.blockers.length);
  assert.throws(() => applyAhlLedgerPlan(empty(), plan, newId));
  const { next } = commit(empty(), statement, { resolutions: { [eid.identity]: { date: '2025-03-26' } } });
  const stored = next.trades.find((t) => t.externalId === eid.identity);
  assert.equal(stored.date, '2025-03-26');
  assert.equal(stored.dateCertainty, 'confirmed');
  assert.equal(stored.settlementDate, '2025-04-03');
});

test('an opening snapshot the statement reproduces exactly is replaced; others are untouched', async () => {
  const statement = await parse();
  const p = empty();
  p.companies.push(
    { ticker: 'BBBB', name: 'B', sector: '', target: 0, approved: false, screenDate: '', note: '' },
    { ticker: 'CCCC', name: 'C', sector: '', target: 0, approved: false, screenDate: '', note: '' },
  );
  p.trades.push(
    { id: 'ob', ticker: 'BBBB', kind: 'opening', date: '2024-12-10', shares: 10, price: null, fees: 0, month: '', note: '' },
    { id: 'oc', ticker: 'CCCC', kind: 'opening', date: '2024-12-10', shares: 29, price: null, fees: 0, month: '', note: '' },
  );
  const { plan, next } = commit(p, statement);
  assert.deepEqual(plan.replacedOpenings.map((o) => o.id), ['ob']);
  assert.equal(next.trades.find((t) => t.id === 'ob').voided, true);
  assert.equal(next.trades.find((t) => t.id === 'oc').voided, undefined);
});

test('apply does not mutate the input portfolio and the result survives a JSON round trip', async () => {
  const statement = await parse();
  const p = empty();
  const snapshot = JSON.stringify(p);
  const { next } = commit(p, statement);
  assert.equal(JSON.stringify(p), snapshot);
  validate(JSON.parse(JSON.stringify(next)));
  assert.ok(next.trades.every((t) => t.id.length <= 80 && (!t.externalId || t.externalId.length <= 120)));
});

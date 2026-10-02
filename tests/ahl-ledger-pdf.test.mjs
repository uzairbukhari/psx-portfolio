import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseAhlLedgerText } from '../lib/ahl-ledger-pdf.ts';
import { applyAhlLedgerPlan, planAhlLedgerImport } from '../lib/ahl-reconcile.ts';
import { CURATED_IPO_OFFERS } from '../lib/ipo-evidence.ts';
import { blankPortfolio, validate } from '../lib/portfolio.ts';
import { buildLedgerPdf, entries, extractLikeBrowser, readBytes } from './helpers/ahl-ledger-fixture.mjs';

test('synthetic PDF goes through the production extraction path and parses exactly', async () => {
  const { bytes, totals } = buildLedgerPdf(entries(), { rowsPerPage: 6 });
  const extracted = await extractLikeBrowser(bytes);
  assert.equal(extracted.pages, 3);
  const statement = await parseAhlLedgerText(extracted.text, extracted.pages);
  assert.equal(statement.trades.length, 10);
  assert.deepEqual(statement.trades.map((t) => t.kind).join(), 'buy,buy,buy,buy,buy,sell,sell,buy,sell,buy');
  assert.equal(statement.totals.debit, totals.debit);
  assert.equal(statement.totals.credit, totals.credit);
  assert.equal(statement.totals.balance, totals.balance);
  assert.equal(statement.pages, 3);
  // excluded categories are reported, never imported
  const by = Object.fromEntries(statement.excluded.map((e) => [e.category, e]));
  assert.equal(by.charge.count, 1);
  assert.equal(by.deposit.count, 1);
  assert.equal(by.interest.count, 1);
  assert.equal(by.tax.count, 1);
  assert.match(statement.accountFingerprint, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(statement.trades).includes('CC00001') && !JSON.stringify(statement.trades).includes('TEST CLIENT'));
});

test('fee arithmetic: gross is rebuilt from net cash and wrapped components, printed rate is fee-inclusive', async () => {
  const { bytes } = buildLedgerPdf(entries());
  const statement = await parseAhlLedgerText((await extractLikeBrowser(bytes)).text);
  const buy = statement.trades[0];
  assert.equal(buy.ticker, 'AAAA');
  assert.equal(buy.price, 157.3);
  assert.equal(buy.priceSnapped, true);
  assert.ok(buy.printedRate > 157.3, 'printed rate includes fees');
  assert.ok(Math.abs(buy.shares * buy.price + buy.fees - buy.netCash) < 1e-9, 'price × shares + fees reproduces reported cash');
  assert.ok(Math.abs(buy.fees - buy.componentFees) <= 0.0105);
  const sell = statement.trades.find((t) => t.ticker === 'IPOX');
  assert.equal(sell.price, 10.7);
  assert.ok(Math.abs(sell.shares * sell.price - sell.fees - sell.netCash) < 1e-9);
});

test('averaged fills keep cash exact instead of snapping to a tick', async () => {
  const statement = await parseAhlLedgerText((await extractLikeBrowser(buildLedgerPdf(entries()).bytes)).text);
  const avg = statement.trades.find((t) => t.ticker === 'DDDD' && t.kind === 'sell');
  assert.equal(avg.priceSnapped, false);
  assert.ok(Math.abs(avg.shares * avg.price - avg.fees - avg.netCash) < 0.0105);
  assert.ok(statement.warnings.some((w) => w.includes('DDDD')));
});

test('identical fills and shared vouchers keep distinct identities', async () => {
  const statement = await parseAhlLedgerText((await extractLikeBrowser(buildLedgerPdf(entries()).bytes)).text);
  const ids = statement.trades.map((t) => t.identity);
  assert.equal(new Set(ids).size, ids.length);
  const dd = statement.trades.filter((t) => t.ticker === 'DDDD' && t.kind === 'buy');
  assert.equal(dd.length, 2);
  assert.ok(dd[0].identity.endsWith(':1') && dd[1].identity.endsWith(':2'));
  const shared = statement.trades.filter((t) => t.voucher === 'CV241204');
  assert.equal(shared.length, 2);
  assert.ok(ids.every((id) => id.length <= 120));
});

test('settlement is converted to execution dates with certainty flags', async () => {
  const statement = await parseAhlLedgerText((await extractLikeBrowser(buildLedgerPdf(entries()).bytes)).text);
  const byVoucher = (v) => statement.trades.find((t) => t.voucher === v);
  // Mon 2 Dec 2024, T+2 -> Thu 28 Nov 2024 (weekend only)
  assert.equal(byVoucher('CV241202').executionDate, '2024-11-28');
  assert.equal(byVoucher('CV241202').dateCertainty, 'confirmed');
  // Thu 3 Apr 2025 T+2 walks Wed 2 Apr, Tue 1 Apr (Eid, press-reported) -> Mon 31 Mar is Eid too -> Fri 28 Mar is Juma-tul-Wida -> Thu 27 Mar
  const eid = byVoucher('CV250403');
  assert.equal(eid.executionDate, '2025-03-27');
  assert.equal(eid.dateCertainty, 'inferred');
  // 2026-06-30 T+1 -> Mon 29 Jun 2026 (official 2026 calendar)
  assert.equal(byVoucher('CV260630').executionDate, '2026-06-29');
  assert.equal(byVoucher('CV260630').dateCertainty, 'confirmed');
  // Mon 17 Aug 2026 T+1 skips Independence Day (Fri 14 Aug) -> Thu 13 Aug
  assert.equal(byVoucher('CV260817').executionDate, '2026-08-13');
});

test('invalid statements fail visibly', async () => {
  const { bytes } = buildLedgerPdf(entries(), { rowsPerPage: 6 });
  const { text } = await extractLikeBrowser(bytes);
  await assert.rejects(parseAhlLedgerText('hello'), /not an Arif Habib/);
  await assert.rejects(parseAhlLedgerText('Arif Habib Limited Client Ledger'), /No readable text/);
  // a missing middle page breaks page order and the balance chain
  const dropped = await extractLikeBrowser(buildLedgerPdf(entries(), { rowsPerPage: 6, dropPage: 1 }).bytes);
  await assert.rejects(parseAhlLedgerText(dropped.text.replace('PDF PAGE 2', 'PDF PAGE 2')), /page 2|out of order|running balance|footer|Page|missing/i);
  // totals removed (cut-off last page)
  const noTotals = await extractLikeBrowser(buildLedgerPdf(entries(), { omitTotals: true }).bytes);
  await assert.rejects(parseAhlLedgerText(noTotals.text), /totals/i);
  // an altered amount breaks the running balance
  await assert.rejects(parseAhlLedgerText(text.replace('200,000.00', '210,000.00')), /running balance|printed totals/);
  // an unknown charge label is never silently guessed
  await assert.rejects(parseAhlLedgerText(text.replace('SST:', 'XYZ:')), /unknown charge/);
  // pdf page count mismatch
  await assert.rejects(parseAhlLedgerText(text, 99), /every page/);
});

test('real supplied statement (set AHL_LOCAL_PDF to its path; skipped otherwise)', { skip: !process.env.AHL_LOCAL_PDF || !existsSync(process.env.AHL_LOCAL_PDF) }, async () => {
  const path = process.env.AHL_LOCAL_PDF;
  const extracted = await extractLikeBrowser(readBytes(path));
  const statement = await parseAhlLedgerText(extracted.text, extracted.pages);
  assert.equal(statement.trades.length, 61);
  assert.equal(statement.trades.filter((t) => t.kind === 'buy').length, 52);
  assert.equal(statement.trades.filter((t) => t.kind === 'sell').length, 9);
  assert.equal(new Set(statement.trades.map((t) => t.ticker)).size, 24);
  assert.deepEqual(statement.totals, { debit: 796875.7, credit: 819420.31, balance: -22544.61 });
  const jsrr = statement.trades.find((t) => t.ticker === 'JSRR');
  assert.equal(jsrr.price, 10.7);
  assert.equal(jsrr.netCash, 15990.75);
  assert.equal(jsrr.componentFees, 59.25);
  assert.equal(jsrr.executionDate, '2026-06-29');
  const ppl = statement.trades.find((t) => t.ticker === 'PPL' && t.kind === 'buy');
  assert.equal(ppl.executionDate, '2024-11-28');
  assert.equal(new Set(statement.trades.map((t) => t.identity)).size, 61);
  // end to end on an empty ledger: all 61 import, JSRR's missing purchase is assumed from the verified IPO offer
  const plan = planAhlLedgerImport(blankPortfolio(), statement, { ipo: { JSRR: CURATED_IPO_OFFERS[0] } });
  assert.equal(plan.counts.imported, 61);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.inferred.length, 1);
  assert.equal(plan.inferred[0].ticker, 'JSRR');
  assert.equal(plan.inferred[0].shares, 1500);
  assert.equal(plan.inferred[0].pricing.basis, 'ipo-offer');
  assert.equal(plan.inferred[0].date, '2026-05-18');
  const next = applyAhlLedgerPlan(blankPortfolio(), plan);
  validate(next);
  assert.equal(next.trades.length, 62);
  assert.equal(planAhlLedgerImport(next, statement, { ipo: { JSRR: CURATED_IPO_OFFERS[0] } }).counts.imported, 0, 're-upload is idempotent');
});

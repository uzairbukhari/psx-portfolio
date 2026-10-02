import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { restLike } from './helpers/d1-rest-like.mjs';
import {
  currentFaceValue, extractFaceValueEvidence, faceValueFor, mergeFaceValueEvidence, parseStatementDate, readFaceValues, resolveFaceValue,
} from '../lib/face-values.ts';
import { runFaceValues } from '../lib/face-value-run.ts';
import { faceValueStatus, requestFaceValues } from '../lib/face-value-api.ts';
import {
  approveSelectedAsReceived, assumeFaceValueForUnresolved, isResolved, isSelectable, planHistoricalDividends, unresolvedFaceValueTickers,
} from '../lib/dividend-history.ts';
import { announcementNotifications } from '../lib/notifications.ts';
import { planAutoDividendUpdate } from '../lib/dividend-sync.ts';
import { blankPortfolio, dividendStatus, pendingAutoDividends } from '../lib/portfolio.ts';

const ev = (faceValue, effectiveFrom = '', extra = {}) => ({ faceValue, effectiveFrom, sourceUrl: 'https://dps.psx.com.pk/doc/1.pdf', sourceLabel: 'Notice', evidence: 'face value', verifiedAt: '2026-10-01', status: 'verified', ...extra });
const company = (ticker, extra = {}) => ({ ticker, name: ticker, sector: 'X', target: 0, approved: false, screenDate: '', note: '', ...extra });
const buy = (id, ticker, date, shares) => ({ id, ticker, kind: 'buy', date, shares, price: 100, fees: 0, month: '', note: '' });
const ann = (over = {}) => ({
  ticker: 'AAAA', announcedOn: '2025-02-20', period: '31/12/2024(YR)', details: '20%(F) (D)', kind: 'cash', percent: 20, perShareRs: null,
  bookClosureStart: '2025-03-20', bookClosureEnd: '2025-03-21', ...over,
});
const base = (companyExtra = {}, trades = [buy('b1', 'AAAA', '2025-01-10', 100)]) => {
  const p = blankPortfolio();
  p.companies.push(company('AAAA', companyExtra));
  p.trades.push(...trades);
  return p;
};
const plan = (p, announcements, options = {}) => planHistoricalDividends(p, announcements, { from: '2024-01-01', to: '2026-09-30', ...options });

test('face value applies by date: Rs 1 and Rs 10, capital changes, gaps and conflicts', () => {
  assert.deepEqual(resolveFaceValue([], '2025-01-01'), { status: 'unresolved', reason: 'none' });
  const one = [ev(1, '2020-01-01')];
  assert.equal(resolveFaceValue(one, '2025-01-01').faceValue, 1);
  assert.deepEqual(resolveFaceValue(one, '2019-12-31'), { status: 'unresolved', reason: 'before-coverage' }, 'a current value is not applied before its evidence starts');
  const split = [ev(10, ''), ev(5, '2024-03-15')];
  assert.equal(resolveFaceValue(split, '2024-03-14').faceValue, 10);
  assert.equal(resolveFaceValue(split, '2024-03-15').faceValue, 5);
  assert.equal(resolveFaceValue(split, '2010-01-01').faceValue, 10);
  assert.deepEqual(resolveFaceValue([ev(10, '', { status: 'conflict' })], '2025-01-01'), { status: 'unresolved', reason: 'conflict' });
  assert.equal(resolveFaceValue([ev(-3, ''), ev(0, ''), ev(5000, '')], '2025-01-01').status, 'unresolved', 'implausible values are not evidence');
  assert.equal(faceValueFor({ faceValue: 5 }, [ev(10, '')], '2025-01-01'), 5, 'the account value wins');
  assert.equal(faceValueFor({}, [ev(10, '')], '2025-01-01'), 10);
  assert.equal(faceValueFor({}, [], '2025-01-01'), null);
});

test('extraction needs an explicit statement; unclear applicability stays unresolved', () => {
  const ctx = { sourceUrl: 'https://dps.psx.com.pk/doc/2.pdf', documentDate: '2025-09-01', verifiedAt: '2026-10-02' };
  const plain = extractFaceValueEvidence('Authorised capital: 1,000,000,000 ordinary shares of Rs. 10/- each.', ctx);
  assert.deepEqual(plain.entries.map((e) => [e.faceValue, e.effectiveFrom]), [[10, '2025-09-01']]);
  const unchanged = extractFaceValueEvidence("The face value of the Company's shares is Rs. 5 per share and has remained unchanged since listing.", ctx);
  assert.deepEqual(unchanged.entries.map((e) => [e.faceValue, e.effectiveFrom]), [[5, '']]);
  const change = extractFaceValueEvidence('Sub-division: face value of ordinary shares will change from Rs. 10 to Rs. 5 per share with effect from March 15, 2024.', ctx);
  assert.deepEqual(change.entries.map((e) => [e.faceValue, e.effectiveFrom]), [[10, ''], [5, '2024-03-15']]);
  const undated = extractFaceValueEvidence('Face value changed from Rs 10 to Rs 5 per share.', ctx);
  assert.deepEqual(undated.entries, []);
  assert.match(undated.unclear[0], /no stated effective date/);
  const contradictory = extractFaceValueEvidence('Ordinary shares of Rs. 10 each. Ordinary shares of Rs. 5 each.', ctx);
  assert.deepEqual(contradictory.entries, []);
  const preference = extractFaceValueEvidence('Ordinary shares of Rs. 10 each and preference shares of Rs. 100 each.', ctx);
  assert.deepEqual(preference.entries.map((e) => e.faceValue), [10], 'preference shares carry their own par value');
  assert.deepEqual(extractFaceValueEvidence('No capital information here.', ctx).entries, []);
  assert.equal(extractFaceValueEvidence('shares of Rs. 10 each', { ...ctx, documentDate: null }).entries.length, 0, 'an undated document cannot say when a value applied');
  assert.equal(parseStatementDate('15th March, 2024'), '2024-03-15');
  assert.equal(parseStatementDate('31-02-2024'), null);
});

test('conflicting evidence marks the value unresolved and keeps the disagreement', () => {
  const first = mergeFaceValueEvidence([], [ev(10, '')]);
  assert.equal(first.length, 1);
  assert.deepEqual(mergeFaceValueEvidence(first, [ev(10, '', { sourceUrl: 'https://other/doc' })]), [], 'agreeing evidence changes nothing');
  const conflicted = mergeFaceValueEvidence(first, [ev(5, '', { sourceUrl: 'https://other/doc' })]);
  assert.equal(conflicted[0].status, 'conflict');
  assert.match(conflicted[0].evidence, /Rs 5 per https:\/\/other\/doc/);
  assert.equal(resolveFaceValue(conflicted, '2025-01-01').status, 'unresolved');
  assert.deepEqual(mergeFaceValueEvidence(conflicted, [ev(5, '', { sourceUrl: 'https://other/doc' })]), [], 'the same disagreement is not recorded twice');
  assert.equal(currentFaceValue([ev(10, '')], '2026-10-02').faceValue, 10);
  assert.equal(currentFaceValue(conflicted, '2026-10-02').faceValue, null);
});

test('planner: Rs 1 and Rs 10 accounts, explicit rupee amounts, and no silent default', () => {
  const ten = plan(base({ faceValue: 10 }), [ann()]).candidates[0];
  const one = plan(base({ faceValue: 1 }), [ann()]).candidates[0];
  assert.deepEqual([ten.perShare, ten.faceValueSource, one.perShare], [2, 'account', 0.2]);
  const none = plan(base(), [ann()]).candidates[0];
  assert.deepEqual([none.perShare, none.gross, none.faceValue, none.faceValueGap], [null, null, null, 'none']);
  assert.ok(none.issues.some((i) => i.kind === 'face-value'));
  assert.equal(isResolved(none), false);
  const rupees = plan(base(), [ann({ percent: null, perShareRs: 3 })]).candidates[0];
  assert.equal(rupees.gross, 300);
  assert.equal(rupees.issues.some((i) => i.kind === 'face-value'), false, 'an explicit rupee amount needs no face value');
});

test('verified evidence resolves previews automatically, by date, without marking income received', () => {
  const p = base();
  const before = plan(p, [ann()]);
  assert.equal(before.candidates[0].perShare, null);
  const after = plan(p, [ann()], { faceValueEvidence: { AAAA: [ev(10, '')] } });
  const c = after.candidates[0];
  assert.deepEqual([c.perShare, c.gross, c.faceValueSource, c.state], [2, 200, 'verified', 'eligible']);
  assert.ok(isResolved(c));
  assert.equal(p.dividends, undefined, 'resolving a face value writes nothing');
  // a payout that predates the evidence is not silently covered by it
  const early = plan(p, [ann()], { faceValueEvidence: { AAAA: [ev(10, '2025-06-01')] } }).candidates[0];
  assert.deepEqual([early.perShare, early.faceValueGap], [null, 'before-coverage']);
  assert.match(early.issues[0].message, /only covers later dates/);
  // a capital change between two payouts: each takes the value that applied
  const split = [ev(10, ''), ev(5, '2025-06-01')];
  const rows = plan(base({}, [buy('b1', 'AAAA', '2025-01-10', 100)]), [ann(), ann({ announcedOn: '2025-08-20', bookClosureStart: '2025-09-20', bookClosureEnd: '2025-09-21' })], { faceValueEvidence: { AAAA: split } }).candidates;
  assert.deepEqual(rows.map((r) => r.perShare).sort((a, b) => a - b), [1, 2]);
  const conflict = plan(p, [ann()], { faceValueEvidence: { AAAA: [ev(10, '', { status: 'conflict' })] } }).candidates[0];
  assert.deepEqual([conflict.perShare, conflict.faceValueGap], [null, 'conflict']);
  assert.match(conflict.issues[0].message, /disagree/);
});

test('precedence: review choice, then the account value; a disagreement with evidence is surfaced, not replaced', () => {
  const evidence = { AAAA: [ev(10, '')] };
  const mine = plan(base({ faceValue: 5 }), [ann()], { faceValueEvidence: evidence }).candidates[0];
  assert.deepEqual([mine.faceValue, mine.faceValueSource, mine.perShare], [5, 'account', 1], 'the explicit account value is preserved');
  const conflict = mine.issues.find((i) => i.kind === 'face-value-conflict');
  assert.ok(conflict && conflict.severity === 'confirm');
  assert.equal(isSelectable(mine), false, 'must be acknowledged first');
  assert.equal(isSelectable(mine, new Set([`${mine.id}|face-value-conflict`])), true);
  const reviewed = plan(base({ faceValue: 5 }), [ann()], { faceValueEvidence: evidence, faceValues: { AAAA: 2 } }).candidates[0];
  assert.deepEqual([reviewed.faceValue, reviewed.faceValueSource], [2, 'review']);
  assert.equal(reviewed.issues.some((i) => i.kind === 'face-value-conflict'), false);
  const agree = plan(base({ faceValue: 10 }), [ann()], { faceValueEvidence: evidence }).candidates[0];
  assert.equal(agree.issues.length, 0);
});

test('bulk Rs 10 assumption: only unresolved companies, counted, correctable, idempotent', () => {
  const p = blankPortfolio();
  for (const t of ['AAAA', 'BBBB', 'CCCC', 'DDDD']) {
    p.companies.push(company(t, t === 'DDDD' ? { faceValue: 5 } : {}));
    p.trades.push(buy('b' + t, t, '2025-01-10', 100));
  }
  const announcements = ['AAAA', 'BBBB', 'CCCC', 'DDDD'].map((t) => ann({ ticker: t }));
  const evidence = { CCCC: [ev(2, '')] };
  const first = plan(p, announcements, { faceValueEvidence: evidence });
  assert.deepEqual(unresolvedFaceValueTickers(first), ['AAAA', 'BBBB']);
  const bulk = assumeFaceValueForUnresolved(first, {}, 10);
  assert.deepEqual(bulk.assumed, ['AAAA', 'BBBB']);
  assert.deepEqual(bulk.faceValues, { AAAA: 10, BBBB: 10 }, 'verified CCCC and the account value of DDDD are untouched');
  const second = plan(p, announcements, { faceValueEvidence: evidence, faceValues: bulk.faceValues });
  assert.equal(unresolvedFaceValueTickers(second).length, 0);
  const by = Object.fromEntries(second.candidates.map((c) => [c.announcement.ticker, c]));
  assert.deepEqual([by.AAAA.perShare, by.CCCC.perShare, by.DDDD.perShare], [2, 0.4, 1]);
  // an individual correction after the bulk step wins, and a repeat of the bulk step changes nothing else
  const corrected = { ...bulk.faceValues, AAAA: 1 };
  assert.equal(plan(p, announcements, { faceValueEvidence: evidence, faceValues: corrected }).candidates.find((c) => c.announcement.ticker === 'AAAA').perShare, 0.2);
  assert.deepEqual(assumeFaceValueForUnresolved(second, bulk.faceValues, 10).assumed, []);
});

test('approval: assumptions stay on the account (flagged), verified values stay in the directory, received records untouched', () => {
  const p = blankPortfolio();
  p.companies.push(company('AAAA'), company('BBBB'));
  p.trades.push(buy('b1', 'AAAA', '2025-01-10', 100), buy('b2', 'BBBB', '2025-01-10', 100));
  p.dividends = [{ id: 'cdc1', ticker: 'BBBB', date: '2024-06-01', source: 'import', perShare: 1, grossAmount: 100, paymentDate: '2024-06-10', taxWithheld: 15 }];
  const announcements = [ann(), ann({ ticker: 'BBBB' })];
  const evidence = { BBBB: [ev(10, '')] };
  const faceValues = { AAAA: 10 };
  const planned = plan(p, announcements, { faceValueEvidence: evidence, faceValues });
  const reviewed = planned.candidates.map((c) => ({ id: c.id, shares: c.shares, perShare: c.perShare, gross: c.gross }));
  const result = approveSelectedAsReceived(p, announcements, { reviewed, faceValues, assumedFaceValues: ['AAAA'], faceValueEvidence: evidence, from: '2024-01-01', to: '2026-09-30' });
  assert.equal(result.ok, true);
  const next = result.portfolio;
  assert.deepEqual([next.companies[0].faceValue, next.companies[0].faceValueAssumed], [10, true], 'the assumption is saved on the account and flagged');
  assert.equal(next.companies[1].faceValue, undefined, 'a verified value is not copied into the account');
  assert.deepEqual(next.dividends.find((d) => d.id === 'cdc1'), p.dividends[0], 'CDC amounts, tax and payment date are untouched');
  assert.equal(next.dividends.filter((d) => d.source === 'auto' && dividendStatus(d) === 'received').length, 2);
  // approving the same review twice does not duplicate (stale / already approved)
  const again = approveSelectedAsReceived(next, announcements, { reviewed, faceValues, faceValueEvidence: evidence, from: '2024-01-01', to: '2026-09-30' });
  assert.equal(again.ok, false);
  // a stale evidence set (the review was prepared with different verified values) writes nothing
  const stale = approveSelectedAsReceived(p, announcements, { reviewed, faceValues, faceValueEvidence: { BBBB: [ev(5, '')] }, from: '2024-01-01', to: '2026-09-30' });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale');
});

test('expected dividends and notifications share the rule: no amount without a face value', () => {
  const p = base({}, [buy('b1', 'AAAA', '2025-01-10', 100)]);
  const a = ann({ bookClosureStart: '2025-03-20' });
  assert.deepEqual(pendingAutoDividends(p, [a], '2025-04-01'), [], 'no invented Rs 10 amount');
  const [d] = pendingAutoDividends(p, [a], '2025-04-01', { AAAA: [ev(10, '')] });
  assert.deepEqual([d.perShare, d.grossAmount, d.status], [2, 200, 'expected']);
  assert.deepEqual(pendingAutoDividends(base({ faceValue: 1 }), [a], '2025-04-01').map((x) => x.perShare), [0.2]);
  const [rupees] = pendingAutoDividends(p, [ann({ percent: null, perShareRs: 2.5 })], '2025-04-01');
  assert.equal(rupees.perShare, 2.5);
  // upcoming announcement notification
  const upcoming = ann({ bookClosureStart: '2025-04-20', announcedOn: '2025-04-01' });
  const without = announcementNotifications(p, [upcoming], '2025-04-02', '2025-04-02T00:00:00Z');
  assert.match(without[0].body, /no amount is calculated/);
  assert.doesNotMatch(without[0].body, /Rs 2\b|About/);
  const withEv = announcementNotifications(p, [upcoming], '2025-04-02', '2025-04-02T00:00:00Z', { AAAA: [ev(10, '')] });
  assert.match(withEv[0].body, /Rs 2\/share/);
  // the sync plan creates nothing for the unresolved payout and a later sync with evidence books it once
  p.dividendTrackingFrom = '2025-01-01';
  const first = planAutoDividendUpdate(p, [a], '2025-04-01T00:00:00Z', '2025-04-01');
  assert.equal(first?.pending.length ?? 0, 0);
  const later = planAutoDividendUpdate(p, [a], '2025-04-02T00:00:00Z', '2025-04-02', { AAAA: [ev(10, '')] });
  assert.equal(later.pending.length, 1);
  const repeat = planAutoDividendUpdate(later.next, [a], '2025-04-03T00:00:00Z', '2025-04-03', { AAAA: [ev(10, '')] });
  assert.equal(repeat === null || repeat.pending.length === 0, true, 'repeated sync is idempotent');
});

test('evidence gathering reads disclosures, records conflicts, updates the catalog and is idempotent', async () => {
  const db = createD1();
  db.sqlite.prepare("INSERT INTO security_catalog (ticker,name,source,first_seen_at,last_seen_at) VALUES ('AAAA','Alpha','x','x','x')").run();
  db.sqlite.prepare("INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES ('AAAA','2026-10-01',?, 'x')").run(JSON.stringify({
    announcements: [
      { date: '2025-09-01', title: 'Annual Report 2025', url: 'https://dps.psx.com.pk/download/1.pdf' },
      { date: '2024-04-01', title: 'Notice of sub-division of shares', url: 'https://dps.psx.com.pk/download/2.pdf' },
      { date: '2025-01-01', title: 'Board meeting to consider dividend', url: 'https://dps.psx.com.pk/download/3.pdf' },
    ],
  }));
  const texts = {
    'https://dps.psx.com.pk/download/1.pdf': 'Authorised capital of 1,000,000,000 ordinary shares of Rs. 5/- each.',
    'https://dps.psx.com.pk/download/2.pdf': 'Face value of ordinary shares changed from Rs. 10 to Rs. 5 effective from 15 March 2024.',
  };
  const fetched = [];
  const io = { d1: restLike(db), fetchDocument: async (url) => { fetched.push(url); if (!texts[url]) throw new Error('unexpected'); return texts[url]; }, now: () => '2026-10-02T10:00:00.000Z' };
  const report = await runFaceValues(io, { tickers: ['AAAA', 'ZZZZ'] });
  assert.equal(fetched.length, 2, 'only relevant disclosures are read');
  assert.equal(report.perTicker[0].found, 3, 'Rs 10 before the change, Rs 5 from it, and the annual report\'s own dated statement');
  const stored = (await readFaceValues(db, ['AAAA'])).AAAA;
  assert.deepEqual(stored.map((e) => [e.faceValue, e.effectiveFrom, e.status]), [[10, '', 'verified'], [5, '2024-03-15', 'verified'], [5, '2025-09-01', 'verified']]);
  assert.equal(db.sqlite.prepare("SELECT face_value FROM security_catalog WHERE ticker='AAAA'").get().face_value, 5);
  assert.equal(resolveFaceValue(stored, '2023-01-01').faceValue, 10);
  assert.equal(report.perTicker[1].found, 0, 'a company with no facts yields no evidence (and no invention)');
  const snapshot = JSON.stringify(db.sqlite.prepare('SELECT * FROM security_face_values ORDER BY ticker,effective_from').all());
  await runFaceValues(io, { tickers: ['AAAA'] });
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM security_face_values ORDER BY ticker,effective_from').all()), snapshot, 'a rerun is idempotent');
  // a contradicting document marks the value unresolved
  texts['https://dps.psx.com.pk/download/1.pdf'] = 'The face value of the Company shares is Rs. 2 and has remained unchanged since listing.';
  const conflict = await runFaceValues(io, { tickers: ['AAAA'] });
  assert.equal(conflict.perTicker[0].conflicts, 1, 'a contradicting document marks that start date as a conflict');
  const afterConflict = (await readFaceValues(db, ['AAAA'])).AAAA;
  assert.deepEqual(resolveFaceValue(afterConflict, '2023-01-01'), { status: 'unresolved', reason: 'conflict' }, 'the disputed start date is unresolved');
  assert.equal(resolveFaceValue(afterConflict, '2026-01-01').faceValue, 5, 'later, undisputed evidence still applies');
  // curated entries from official documents are validated
  const curated = await runFaceValues(io, { tickers: ['BBBB'], curated: [
    { ticker: 'BBBB', faceValue: 10, effectiveFrom: '', sourceUrl: 'https://issuer.example/ar.pdf', sourceLabel: 'Annual report' },
    { ticker: 'BBBB', faceValue: -1, effectiveFrom: '', sourceUrl: 'https://issuer.example/ar.pdf' },
    { ticker: 'BBBB', faceValue: 10, effectiveFrom: '', sourceUrl: 'not a url' },
  ] });
  assert.equal(curated.perTicker[0].found, 1);
  assert.equal(curated.perTicker[0].unclear.length, 2);
});

test('face value requests: ledger scope, one dispatch under concurrency, staging never dispatches, honest status', async () => {
  const db = createD1();
  const p = base({}, [buy('b1', 'AAAA', '2025-01-10', 10)]);
  p.companies.push(company('BBBB'));
  p.trades.push(buy('b2', 'BBBB', '2025-01-10', 10), buy('b3', 'ZZZZ', '2025-01-10', 10));
  const config = { token: 't', repo: 'o/r', appEnv: 'production' };
  const calls = [];
  const fetcher = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 204 }; };
  await db.sqlite.prepare("INSERT INTO security_face_values (ticker,effective_from,face_value,source_url,verified_at,status) VALUES ('BBBB','',10,'https://x/y','2026-10-01','verified')").run();
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => requestFaceValues(db, `u${i}@x`, p, config, ['AAAA', 'BBBB', 'ZZZZ', 'OUTSIDE'], fetcher)));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].inputs, { tickers: 'AAAA' }, 'only the ledger company without evidence is looked up');
  assert.deepEqual(results[0].tickers, ['AAAA', 'BBBB'].filter((t) => p.companies.some((c) => c.ticker === t)));
  const status = await faceValueStatus(db, p, config);
  assert.equal(status.evidence.BBBB[0].faceValue, 10);
  assert.equal(status.states.find((s) => s.ticker === 'AAAA').state, 'queued');
  const staging = await requestFaceValues(createD1(), 'u@x', p, { ...config, appEnv: 'staging' }, undefined, fetcher);
  assert.equal(calls.length, 1);
  assert.match(staging.message, /not available/);
  await assert.rejects(requestFaceValues(createD1(), 'u@x', blankPortfolio(), config, undefined, fetcher), /no companies/);
});

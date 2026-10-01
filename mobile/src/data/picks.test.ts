import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, validate } from '../../../lib/portfolio.ts';
import { MAX_SHORTLIST, initialShortlist, pickSources, searchCompanies, withPicksInputs } from './picks.ts';

function sample(n = 3) {
  const p = blankPortfolio();
  p.companies = Array.from({ length: n }, (_, i) => ({
    ticker: `T${String(i).padStart(2, '0')}`, name: i === 1 ? 'Meezan Bank' : `Company ${i}`, sector: 'Bank',
    target: i === 0 ? 100 : 0, approved: true, screenDate: '', note: '',
  }));
  return p;
}

test('the screen starts from the saved shortlist, else the targeted companies, capped at 15', () => {
  const p = sample();
  assert.deepEqual(initialShortlist(p), ['T00']);
  p.monthlyPicksShortlist = ['T02', 'T01'];
  assert.deepEqual(initialShortlist(p), ['T02', 'T01']);
  const big = sample(20);
  big.monthlyPicksShortlist = big.companies.map((c) => c.ticker);
  assert.equal(initialShortlist(big).length, MAX_SHORTLIST);
});

test('withPicksInputs saves the shortlist and the month amount where the web reads them', () => {
  const p = sample();
  const next = withPicksInputs(p, '2026-10', ['T01', 'T02'], 75_000)!;
  validate(next);
  assert.deepEqual(next.monthlyPicksShortlist, ['T01', 'T02']);
  assert.equal(next.budgets['2026-10'], 75_000);
  assert.equal(p.monthlyPicksShortlist, undefined);
  assert.equal(p.budgets['2026-10'], undefined);
});

test('withPicksInputs returns null when nothing changed, and drops unknown or duplicate tickers', () => {
  const p = sample();
  const saved = withPicksInputs(p, '2026-10', ['T01'], 50_000)!;
  assert.equal(withPicksInputs(saved, '2026-10', ['T01'], 50_000), null);
  assert.deepEqual(withPicksInputs(saved, '2026-10', ['T01', 'T01', 'ZZZ', 'T02'], 50_000)!.monthlyPicksShortlist, ['T01', 'T02']);
  assert.equal(withPicksInputs(saved, '2026-10', ['T01'], 60_000)!.budgets['2026-10'], 60_000);
  assert.equal(withPicksInputs(saved, '2026-11', ['T01'], 50_000)!.budgets['2026-10'], 50_000, 'other months keep their budget');
});

test('withPicksInputs rejects a bad month or amount', () => {
  const p = sample();
  assert.throws(() => withPicksInputs(p, '2026-13', ['T00'], 1000), /Invalid month/);
  assert.throws(() => withPicksInputs(p, '2026-10', ['T00'], 0), /amount to invest/);
  assert.throws(() => withPicksInputs(p, '2026-10', ['T00'], NaN), /amount to invest/);
});

test('searchCompanies matches ticker or name, ignoring case and spacing', () => {
  const { companies } = sample();
  assert.equal(searchCompanies(companies, '').length, 3);
  assert.deepEqual(searchCompanies(companies, ' meezan ').map((c) => c.ticker), ['T01']);
  assert.deepEqual(searchCompanies(companies, 't02').map((c) => c.ticker), ['T02']);
  assert.deepEqual(searchCompanies(companies, 'nothing'), []);
});

test('pickSources prefers titled details, falls back to hosts, and keeps only web links once', () => {
  const details = pickSources({
    sourceUrls: [],
    sourceDetails: [
      { url: 'https://dps.psx.com.pk/company/MEBL', title: 'PSX company page', date: '2026-09-30' },
      { url: 'https://dps.psx.com.pk/company/MEBL', title: 'dup', date: '' },
      { url: 'javascript:alert(1)', title: 'bad', date: '' },
      { url: 'not a url', title: 'bad', date: '' },
      { url: 'https://www.example.com/report.pdf', title: '  ', date: '' },
    ],
  });
  assert.deepEqual(details, [
    { url: 'https://dps.psx.com.pk/company/MEBL', title: 'PSX company page', date: '2026-09-30' },
    { url: 'https://www.example.com/report.pdf', title: 'example.com', date: '' },
  ]);
  assert.deepEqual(pickSources({ sourceUrls: ['http://a.test/x', 'file:///etc/passwd'] }), [{ url: 'http://a.test/x', title: 'a.test', date: '' }]);
  assert.deepEqual(pickSources({ sourceUrls: [], sourceDetails: [] }), []);
});

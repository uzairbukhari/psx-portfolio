import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFacts, newTickers, titleCaseSector } from '../lib/company-enrichment.ts';

function facts(ticker, name, sector) {
  return { ticker, name, sector, price: 1, priceDate: '2026-09-25', peTtm: null,
    week52: { low: null, high: null }, change1y: null, changeYtd: null,
    marketCapThousands: null, freeFloatPct: null, annual: [], quarterly: [],
    ratios: { grossMargin: [], netMargin: [], epsGrowth: [], peg: [] },
    announcements: [], source: '', fetchedAt: '2026-09-25T00:00:00Z' };
}
function company(ticker, name, sector) {
  return { ticker, name, sector, target: 0, approved: false, screenDate: '', note: '' };
}

test('titleCaseSector title-cases a raw all-caps PSX sector string', () => {
  assert.equal(titleCaseSector('COMMERCIAL BANKS'), 'Commercial Banks');
  assert.equal(titleCaseSector('OIL & GAS EXPLORATION COMPANIES'), 'Oil & Gas Exploration Companies');
});

test('applyFacts overwrites name/sector only for tickers with available facts', () => {
  const companies = [
    company('MEBL', 'MEBL', ''),
    company('LUCK', 'LUCK', ''),
    company('UNKNOWNTICKER', 'UNKNOWNTICKER', ''),
  ];
  applyFacts(companies, [
    facts('MEBL', 'Meezan Bank Limited', 'COMMERCIAL BANKS'),
    facts('LUCK', 'Lucky Cement Limited', 'CEMENT'),
    { ticker: 'UNKNOWNTICKER', unavailable: 'PSX fetch failed.' },
  ]);
  assert.deepEqual(companies[0], company('MEBL', 'Meezan Bank Limited', 'Commercial Banks'));
  assert.deepEqual(companies[1], company('LUCK', 'Lucky Cement Limited', 'Cement'));
  assert.deepEqual(companies[2], company('UNKNOWNTICKER', 'UNKNOWNTICKER', ''), 'unavailable ticker left untouched');
});

test('applyFacts never touches a ticker facts has nothing for', () => {
  const companies = [company('MEBL', 'My Custom Name', 'Bank')];
  applyFacts(companies, [facts('LUCK', 'Lucky Cement Limited', 'CEMENT')]);
  assert.deepEqual(companies[0], company('MEBL', 'My Custom Name', 'Bank'));
});

test('newTickers returns only tickers absent from the previous portfolio', () => {
  const previous = { companies: [company('MEBL', 'Meezan Bank Limited', 'Bank')], trades: [], quotes: {}, budgets: {} };
  const incoming = {
    companies: [
      company('MEBL', 'Meezan Bank Limited', 'Bank'),
      company('LUCK', 'LUCK', ''),
    ],
    trades: [], quotes: {}, budgets: {},
  };
  assert.deepEqual(newTickers(previous, incoming), ['LUCK']);
});

test('newTickers treats every company as new when there is no previous portfolio', () => {
  const incoming = { companies: [company('MEBL', 'MEBL', ''), company('LUCK', 'LUCK', '')], trades: [], quotes: {}, budgets: {} };
  assert.deepEqual(newTickers(null, incoming), ['MEBL', 'LUCK']);
});

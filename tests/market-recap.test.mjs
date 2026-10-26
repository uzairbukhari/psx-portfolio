import test from 'node:test';
import assert from 'node:assert/strict';
import { caption, intWords, percentWords, shortName, spokenParts } from '../scripts/market-recap-data.mjs';

const recap = {
  date: '2026-10-23',
  index: { close: 165432.1, change: -812.4, changePercent: -0.49 },
  gainers: [{ name: 'Meezan Bank', changePercent: 5.2 }, { name: 'Hub Power', changePercent: 4.1 }],
  losers: [{ name: 'Lucky Cement', changePercent: -3.1 }],
  active: [{ name: 'K-Electric' }, { name: 'WorldCall Telecom' }],
  dividends: [{ name: 'Oil & Gas Development', percent: 25 }],
};

test('numbers are read in short groups', () => {
  assert.equal(intWords(21), 'twenty-one');
  assert.equal(intWords(812), 'eight hundred twelve');
  assert.match(intWords(165432), /^one hundred sixty-five thousand,<break time="0.4s"\/> four hundred thirty-two$/);
  assert.equal(percentWords(5.2), 'five point two percent');
  assert.equal(percentWords(-0.49), 'zero point four nine percent');
  assert.equal(percentWords(25), 'twenty-five percent');
});

test('company names are spoken without legal suffixes', () => {
  assert.equal(shortName('Meezan Bank Limited'), 'Meezan Bank');
  assert.equal(shortName('Engro Corporation Ltd.'), 'Engro Corporation');
  assert.equal(shortName('Lucky Cement Limited (Pvt)'), 'Lucky Cement');
});

test('one clip per slide, company names only, no tickers', () => {
  const parts = spokenParts(recap);
  assert.equal(parts.length, 5);
  assert.match(parts[1], /Meezan Bank, up five point two percent/);
  assert.match(parts[3], /Oil & Gas Development announced a twenty-five percent cash dividend/);
  assert.match(caption(recap), /Gainers: Meezan Bank, Hub Power/);
});

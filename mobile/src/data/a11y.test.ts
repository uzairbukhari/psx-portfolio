import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSummary, signedAmountLabel, signedPercentLabel } from './a11y.ts';

test('signed amounts are spoken as gain or loss of a positive figure', () => {
  assert.match(signedAmountLabel(1500) ?? '', /^gain of .*1,500/);
  assert.match(signedAmountLabel(-300) ?? '', /^loss of .*300/);
  assert.doesNotMatch(signedAmountLabel(-300), /-/);
  assert.equal(signedAmountLabel(0), 'no change');
  assert.equal(signedAmountLabel(null), 'not available');
});

test('percent labels say up or down', () => {
  assert.equal(signedPercentLabel(2.5), 'up 2.50 percent');
  assert.equal(signedPercentLabel(-1.234), 'down 1.23 percent');
  assert.equal(signedPercentLabel(0), 'unchanged');
  assert.equal(signedPercentLabel(null), 'not available');
});

test('chart summary gives direction, ends and range', () => {
  const text = chartSummary([[1, 100], [2, 90], [3, 120]], 'MEBL price');
  assert.match(text, /^MEBL price: up, from .*100.* to .*120/);
  assert.match(text, /low .*90/);
  assert.match(text, /3 points/);
  assert.match(chartSummary([[1, 5]], 'X'), /not enough data/);
});

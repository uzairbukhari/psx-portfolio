import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEARCH_BUDGET_MICROS,
  hasPdfSignature,
  researchReserveMicros,
  validPsxTicker,
  validScorecard,
} from '../lib/research-policy.mjs';

test('research reservation remains below the per-company cap for the bounded request', () => {
  const reserve = researchReserveMicros(900_000, 14_000);
  assert.ok(reserve > 0);
  assert.ok(reserve < RESEARCH_BUDGET_MICROS);
});

test('seven-category scores enforce framework limits and preserve null gaps', () => {
  assert.equal(validScorecard([18, 17, 12, 8, null, 11, 7]), true);
  assert.equal(validScorecard([21, 17, 12, 8, 7, 11, 7]), false);
  assert.equal(validScorecard([18, 17, 12, 8, 7]), false);
});

test('PDF validation rejects HTML returned by an official-looking URL', () => {
  assert.equal(hasPdfSignature(Buffer.from('%PDF-1.7\n')), true);
  assert.equal(
    hasPdfSignature(Buffer.from('<html>Access denied</html>')),
    false,
  );
});

test('ticker validation accepts PSX symbols and rejects path-like input', () => {
  assert.equal(validPsxTicker('MEBL'), true);
  assert.equal(validPsxTicker('786'), true);
  assert.equal(validPsxTicker('../MEBL'), false);
});

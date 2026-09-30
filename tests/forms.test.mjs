import test from 'node:test';
import assert from 'node:assert/strict';
import { parseField, fieldText, hasErrors } from '../lib/forms.ts';

test('parseField treats empty and invalid text as null, not zero', () => {
  assert.equal(parseField(''), null);
  assert.equal(parseField('   '), null);
  assert.equal(parseField('abc'), null);
  assert.equal(parseField('Infinity'), null);
  assert.equal(parseField('0'), 0);
  assert.equal(parseField(' 12.5 '), 12.5);
});
test('fieldText round-trips', () => {
  assert.equal(fieldText(null), '');
  assert.equal(fieldText(0), '0');
  assert.equal(parseField(fieldText(3.25)), 3.25);
});
test('hasErrors', () => {
  assert.equal(hasErrors({}), false);
  assert.equal(hasErrors({ a: 'x' }), true);
});

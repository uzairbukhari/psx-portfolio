import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceEntry, voidEntry } from '../lib/corrections.ts';

const list = () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('replaceEntry voids the old entry and inserts the new one right after it', () => {
  const out = replaceEntry(list(), 'b', { id: 'b2' });
  assert.deepEqual(out, [{ id: 'a' }, { id: 'b', voided: true }, { id: 'b2' }, { id: 'c' }]);
});
test('replaceEntry appends when there is nothing to replace', () => {
  assert.deepEqual(replaceEntry(list(), null, { id: 'd' }).at(-1), { id: 'd' });
  assert.equal(replaceEntry(list(), 'missing', { id: 'd' }).length, 4);
});
test('replaceEntry does not mutate its input', () => {
  const input = list();
  replaceEntry(input, 'a', { id: 'z' });
  assert.deepEqual(input, list());
});
test('voidEntry marks only the target', () => {
  assert.deepEqual(voidEntry(list(), 'c'), [{ id: 'a' }, { id: 'b' }, { id: 'c', voided: true }]);
});
test('voidEntry can restore a voided entry', () => {
  const voided = voidEntry(list(), 'b');
  assert.deepEqual(voidEntry(voided, 'b', false), list());
});

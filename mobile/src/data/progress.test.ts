import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepStates } from './progress.ts';

test('steps fill left to right with one in progress', () => {
  assert.deepEqual(stepStates(0, 4), ['todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(stepStates(0.5, 4), ['done', 'done', 'todo', 'todo']);
  assert.deepEqual(stepStates(0.37, 6), ['done', 'done', 'on', 'todo', 'todo', 'todo']);
  assert.deepEqual(stepStates(1, 3), ['done', 'done', 'done']);
  assert.deepEqual(stepStates(2, 3), ['done', 'done', 'done']);
  assert.deepEqual(stepStates(Number.NaN, 2), ['todo', 'todo']);
  assert.deepEqual(stepStates(-1, 2), ['todo', 'todo']);
});

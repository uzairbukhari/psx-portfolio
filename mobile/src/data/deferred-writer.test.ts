import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredWriter } from './deferred-writer.ts';

test('writes are deferred and only the newest value per key is written', () => {
  const tasks: (() => void)[] = [];
  const written: [string, number][] = [];
  const enqueue = createDeferredWriter<number>((run) => tasks.push(run), (k, v) => void written.push([k, v]));
  enqueue('a', 1);
  enqueue('a', 2);
  enqueue('b', 3);
  assert.deepEqual(written, [], 'nothing is written synchronously');
  assert.equal(tasks.length, 1, 'one flush is scheduled for the burst');
  tasks[0]();
  assert.deepEqual(written, [['a', 2], ['b', 3]]);
  enqueue('a', 4);
  assert.equal(tasks.length, 2, 'a later write schedules a new flush');
  tasks[1]();
  assert.deepEqual(written.at(-1), ['a', 4]);
});

test('a failing write does not stop the others', () => {
  const tasks: (() => void)[] = [];
  const written: string[] = [];
  const enqueue = createDeferredWriter<number>((run) => tasks.push(run), (k) => {
    if (k === 'bad') throw new Error('disk full');
    written.push(k);
  });
  enqueue('bad', 1);
  enqueue('good', 2);
  tasks[0]();
  assert.deepEqual(written, ['good']);
});

test('cancel drops a queued write', () => {
  const tasks: (() => void)[] = [];
  const written: string[] = [];
  const enqueue = createDeferredWriter<number>((run) => tasks.push(run), (k) => void written.push(k));
  enqueue('a', 1);
  enqueue.cancel('a');
  tasks[0]();
  assert.deepEqual(written, []);
});

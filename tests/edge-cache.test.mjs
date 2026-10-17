import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeCached } from '../lib/edge-cache.ts';

function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(request) {
      const hit = store.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
}

test('loads once, then serves the cached value', async () => {
  const cache = fakeCache();
  let loads = 0;
  const load = async () => ({ n: ++loads });
  assert.deepEqual(await edgeCached('k', 60, load, undefined, cache), { n: 1 });
  assert.deepEqual(await edgeCached('k', 60, load, undefined, cache), { n: 1 });
  assert.equal(loads, 1);
});

test('keys do not collide and the request URL never decides the key', async () => {
  const cache = fakeCache();
  assert.deepEqual(await edgeCached('a', 60, async () => 1, undefined, cache), 1);
  assert.deepEqual(await edgeCached('b', 60, async () => 2, undefined, cache), 2);
  assert.equal(cache.store.size, 2);
});

test('without a Cache API it just loads', async () => {
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await edgeCached('k', 60, load, undefined, undefined), 1);
  assert.equal(await edgeCached('k', 60, load, undefined, undefined), 2);
});

test('a failing cache never breaks the response', async () => {
  const broken = {
    async match() {
      throw new Error('boom');
    },
    async put() {
      throw new Error('boom');
    },
  };
  assert.equal(await edgeCached('k', 60, async () => 7, undefined, broken), 7);
});

test('serves from memory when the Cache API stores nothing (workers.dev)', async () => {
  const cache = { async match() { return undefined; }, async put() {} };
  let loads = 0;
  const load = async () => ({ n: ++loads });
  await edgeCached('mem', 60, load, undefined, cache);
  await edgeCached('mem', 60, load, undefined, cache);
  assert.equal(loads, 1);
});

test('a load that throws is not remembered', async () => {
  const cache = { async match() { return undefined; }, async put() {} };
  await assert.rejects(edgeCached('boom', 60, async () => { throw new Error('x'); }, undefined, cache));
  assert.equal(await edgeCached('boom', 60, async () => 7, undefined, cache), 7);
});

test('an answer that is not worth caching is served but asked again next time', async () => {
  const cache = fakeCache();
  let loads = 0;
  const load = async () => ({ rows: loads++ === 0 ? [] : [1] });
  const worth = (v) => v.rows.length > 0;
  assert.deepEqual(await edgeCached('k', 60, load, undefined, cache, worth), { rows: [] });
  assert.deepEqual(await edgeCached('k', 60, load, undefined, cache, worth), { rows: [1] });
  assert.deepEqual(await edgeCached('k', 60, load, undefined, cache, worth), { rows: [1] });
  assert.equal(loads, 2);
});

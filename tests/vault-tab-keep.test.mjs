import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetTabKey, hasTabKey, keepTabKey, recallTabKey } from '../lib/vault-tab-keep.ts';

function fakeStore() {
  const items = new Map();
  let wrap;
  return {
    items,
    store: {
      session: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v), removeItem: (k) => items.delete(k) },
      wrapKey: { get: async () => wrap, set: async (k) => { wrap = k; }, delete: async () => { wrap = undefined; } },
    },
    lose: () => { wrap = undefined; },
  };
}
const key = () => crypto.getRandomValues(new Uint8Array(32));

test('a kept key comes back for the same account and vault, and is never stored in the clear', async () => {
  const { store, items } = fakeStore();
  const data = key();
  assert.equal(await keepTabKey(store, 'A@x.com', 'v1', data), true);
  assert.ok(hasTabKey(store));
  const stored = [...items.values()].join('');
  assert.ok(!stored.includes(Buffer.from(data).toString('base64')), 'raw key must not be in storage');
  assert.deepEqual(await recallTabKey(store, 'a@x.com', 'v1'), data);
});

test('the wrapping key is non-extractable', async () => {
  const { store } = fakeStore();
  await keepTabKey(store, 'a@x.com', 'v1', key());
  const wrap = await store.wrapKey.get();
  assert.equal(wrap.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', wrap));
});

test('a different account or vault gets nothing and clears the stored copy', async () => {
  for (const [email, vault] of [['b@x.com', 'v1'], ['a@x.com', 'v2']]) {
    const { store } = fakeStore();
    await keepTabKey(store, 'a@x.com', 'v1', key());
    assert.equal(await recallTabKey(store, email, vault), null);
    assert.equal(hasTabKey(store), false);
  }
});

test('forgetting, a missing wrap key or tampered ciphertext all end locked', async () => {
  let s = fakeStore();
  await keepTabKey(s.store, 'a@x.com', 'v1', key());
  await forgetTabKey(s.store);
  assert.equal(await recallTabKey(s.store, 'a@x.com', 'v1'), null);

  s = fakeStore();
  await keepTabKey(s.store, 'a@x.com', 'v1', key());
  s.lose();
  assert.equal(await recallTabKey(s.store, 'a@x.com', 'v1'), null);
  assert.equal(hasTabKey(s.store), false);

  s = fakeStore();
  await keepTabKey(s.store, 'a@x.com', 'v1', key());
  const saved = JSON.parse(s.items.get('sipwise-vault-tab-key'));
  saved.ct = Buffer.from(Buffer.from(saved.ct, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64');
  s.items.set('sipwise-vault-tab-key', JSON.stringify(saved));
  assert.equal(await recallTabKey(s.store, 'a@x.com', 'v1'), null);
  assert.equal(hasTabKey(s.store), false);
});

test('a browser that cannot store the key keeps nothing', async () => {
  const { store } = fakeStore();
  store.wrapKey.set = async () => { throw new Error('IndexedDB unavailable'); };
  assert.equal(await keepTabKey(store, 'a@x.com', 'v1', key()), false);
  assert.equal(hasTabKey(store), false);
});

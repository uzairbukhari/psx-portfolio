import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPsxTimeseries } from '../lib/psx-fetch.ts';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

async function withFetch(replies, run) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const reply = replies[calls++];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  try {
    return await run(() => calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('retries a transient 500 and a timeout, then returns the data', async () => {
  await withFetch(
    [json({}, 500), new Error('The operation was aborted due to timeout'), json({ status: 1, data: [[1, 2, 3]] })],
    async (calls) => {
      assert.deepEqual(await fetchPsxTimeseries('MEBL', 'int', 'tok'), [[1, 2, 3]]);
      assert.equal(calls(), 3);
    },
  );
});

test('does not retry a 404 and gives up after three failed attempts', async () => {
  await withFetch([json({}, 404)], async (calls) => {
    await assert.rejects(fetchPsxTimeseries('MEBL', 'int', 'tok'), /404 from PSX/);
    assert.equal(calls(), 1);
  });
  await withFetch([json({}, 500), json({}, 500), json({}, 500)], async (calls) => {
    await assert.rejects(fetchPsxTimeseries('MEBL', 'eod', 'tok'), /500 from PSX/);
    assert.equal(calls(), 3);
  });
});

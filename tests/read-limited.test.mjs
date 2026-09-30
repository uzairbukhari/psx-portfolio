import assert from 'node:assert/strict';
import test from 'node:test';
import { readLimited } from '../lib/read-limited.ts';

const chunked = (sizes, headers = {}) => {
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (pulled === sizes.length) return controller.close();
      controller.enqueue(new Uint8Array(sizes[pulled++]).fill(1));
    },
  });
  return { response: new Response(body, { headers }), pulled: () => pulled };
};

test('returns the whole body when it fits the limit', async () => {
  const { response } = chunked([3, 4]);
  const bytes = await readLimited(response, 10);
  assert.equal(bytes.byteLength, 7);
});

test('stops reading once the streamed body passes the limit', async () => {
  const { response, pulled } = chunked([4, 4, 4, 4, 4, 4]);
  await assert.rejects(readLimited(response, 6), /too large/);
  assert.ok(pulled() < 6, `read ${pulled()} of 6 chunks`);
});

test('rejects early on a declared content-length over the limit', async () => {
  const { response, pulled } = chunked([4], { 'content-length': '100' });
  await assert.rejects(readLimited(response, 10), /too large/);
  assert.equal(pulled(), 0);
});

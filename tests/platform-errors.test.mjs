import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlatformResponse } from '../lib/platform-errors.ts';
import { classifyError } from '../lib/error-codes.ts';
import { onPlatformError, readJson } from '../lib/safe-json.ts';

test('Cloudflare error pages are told apart from the app\'s own JSON errors', () => {
  assert.equal(classifyPlatformResponse(503, '<html>Error 1102 Worker exceeded resource limits</html>'), 'cf_worker_limit');
  assert.equal(classifyPlatformResponse(429, '<html>Error 1027 Worker exceeded free tier daily request limit</html>'), 'cf_daily_limit');
  assert.equal(classifyPlatformResponse(429, '<html>slow down</html>'), 'cf_rate_limited');
  assert.equal(classifyPlatformResponse(524, '<html>A timeout occurred</html>'), 'cf_timeout');
  assert.equal(classifyPlatformResponse(502, '<html>Bad gateway</html>'), 'cf_unavailable');
  assert.equal(classifyPlatformResponse(503, '{"error":"Encrypted portfolio storage is not available."}'), null);
  assert.equal(classifyPlatformResponse(200, '<html>fine</html>'), null);
  assert.equal(classifyPlatformResponse(404, '<html>not found</html>'), null);
});

test('readJson reports a platform page once to listeners and still never throws', async () => {
  const seen = [];
  const off = onPlatformError((c) => seen.push(c));
  const body = await readJson(new Response('<html>Error 1102 Worker exceeded resource limits</html>', { status: 503 }));
  assert.equal(body.platform, 'cf_worker_limit');
  assert.match(body.error, /busy/);
  assert.deepEqual(seen, ['cf_worker_limit']);
  assert.deepEqual(await readJson(Response.json({ a: 1 })), { a: 1 });
  assert.equal((await readJson(new Response('oops', { status: 200 }))).error.length > 0, true);
  off();
  await readJson(new Response('<html>1102</html>', { status: 503 }));
  assert.equal(seen.length, 1);
});

test('the calm platform messages map back to platform audit codes', () => {
  assert.deepEqual(classifyError('Sipwise is busy right now. Please try again in a minute.'), { area: 'platform', code: 'cf_worker_limit' });
  assert.deepEqual(classifyError('This is temporarily unavailable. Please try again shortly.'), { area: 'platform', code: 'cf_unavailable' });
});

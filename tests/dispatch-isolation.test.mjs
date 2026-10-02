import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchBlockedReason, dispatchEnabled, requestFacts } from '../lib/github-dispatch.ts';

test('staging never dispatches the production-writing workflow, even with a token and repo', async () => {
  const config = { token: 't', repo: 'o/r', appEnv: 'staging' };
  assert.match(dispatchBlockedReason(config), /staging/);
  assert.equal(dispatchEnabled(config), false);
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('', { status: 204 }); };
  try {
    const result = await requestFacts({}, config, ['MEBL']);
    assert.equal(result.dispatched, false);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('production needs both a token and a repo', () => {
  assert.equal(dispatchEnabled({ appEnv: 'production', token: 't', repo: 'o/r' }), true);
  assert.equal(dispatchEnabled({ appEnv: 'production', token: 't' }), false);
  assert.equal(dispatchEnabled({}), false);
});

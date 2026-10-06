import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWorkflow, dueWorkflows } from '../lib/scrape-schedule.ts';

const at = (iso) => dueWorkflows(new Date(iso)).map((item) => item.workflow);

test('quotes start every 5 minutes in market hours, history every 15', () => {
  assert.deepEqual(at('2026-10-06T04:00:00Z'), ['psx-quotes.yml', 'psx-history.yml']);
  assert.deepEqual(at('2026-10-06T04:05:00Z'), ['psx-quotes.yml']);
  assert.deepEqual(at('2026-10-06T11:55:00Z'), ['psx-quotes.yml']);
  assert.deepEqual(at('2026-10-06T11:45:00Z'), ['psx-quotes.yml', 'psx-history.yml']);
});

test('history runs once after the close and nothing runs outside market hours or at weekends', () => {
  assert.deepEqual(at('2026-10-06T12:10:00Z'), ['psx-history.yml']);
  assert.deepEqual(at('2026-10-06T03:55:00Z'), []);
  assert.deepEqual(at('2026-10-06T12:15:00Z'), []);
  assert.deepEqual(at('2026-10-10T05:00:00Z'), []);
  assert.deepEqual(at('2026-10-11T05:00:00Z'), []);
});

test('dispatch posts to the workflow on main and reports failures', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); };
  assert.equal(await dispatchWorkflow({ token: 't', repo: 'o/r' }, 'psx-quotes.yml', ok), null);
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/actions/workflows/psx-quotes.yml/dispatches');
  assert.equal(JSON.parse(calls[0].init.body).ref, 'main');
  assert.match(await dispatchWorkflow({ token: 't', repo: 'o/r' }, 'x.yml', async () => new Response('', { status: 403 })), /403/);
  assert.match(await dispatchWorkflow({ repo: 'o/r' }, 'x.yml', ok), /not set/);
  assert.match(await dispatchWorkflow({ token: 't', repo: 'o/r', appEnv: 'staging' }, 'x.yml', ok), /staging/);
});

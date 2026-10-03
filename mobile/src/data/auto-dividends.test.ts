import test from 'node:test';
import assert from 'node:assert/strict';
import type { PortfolioResponse } from '../../../lib/api-types.ts';
import { syncAnnouncementsOnLoad } from './auto-dividends.ts';

const NOW = '2025-08-30T10:00:00Z';
const OPTS = { now: () => NOW, asOf: '2025-08-30' };
const base = (extra = {}): PortfolioResponse['portfolio'] => ({
  companies: [{ ticker: 'MEBL', name: 'Meezan', sector: 'Banks', target: 0, approved: true, screenDate: '', note: '', faceValue: 10 }],
  trades: [{ id: 'b1', ticker: 'MEBL', kind: 'buy', date: '2025-01-02', shares: 100, price: 100, fees: 0, month: '2025-01', note: '' }],
  quotes: {}, budgets: {}, dividendTrackingFrom: '2025-01-01', ...extra,
});
const announcement = {
  ticker: 'MEBL', announcedOn: '2025-08-13', period: '30/06/2025(HYR)', details: '70%(ii) (D)', kind: 'cash' as const,
  percent: 70, perShareRs: null, bookClosureStart: '2025-08-27', bookClosureEnd: '2025-08-28',
};
const response = (revision = 5, announcements = [announcement], portfolio = base()): PortfolioResponse => ({ portfolio, revision, announcements });

function fakeApi(puts: (n: number, body: any) => unknown, gets: () => unknown = () => response(9)) {
  const calls = { put: [] as any[], get: 0 };
  return {
    calls,
    save: async (portfolio: unknown, revision: number) => {
      const body = { portfolio, revision };
      calls.put.push(body);
      return (await puts(calls.put.length, body)) as { revision: number } | { conflict: true };
    },
    reload: async () => {
      calls.get++;
      const fresh = (await gets()) as PortfolioResponse | null;
      return fresh ? { portfolio: fresh.portfolio, revision: fresh.revision } : null;
    },
  };
}

test('books the expected dividend and alert with one revisioned PUT', async () => {
  const api = fakeApi(() => ({ revision: 6 }));
  const out = await syncAnnouncementsOnLoad(api, response(), OPTS);
  assert.equal(api.calls.put.length, 1);
  assert.equal(api.calls.put[0].revision, 5);
  assert.equal(out.revision, 6);
  assert.equal(out.portfolio.dividends!.length, 1);
  assert.equal(out.portfolio.dividends![0].status, 'expected');
  assert.equal(out.portfolio.notifications![0].id, 'div:psx:MEBL:2025-08-27:2025-08-13');
  assert.deepEqual(out.announcements, [announcement]);
});

test('writes nothing when there is nothing new', async () => {
  const api = fakeApi(() => assert.fail('must not write'));
  const data = response(5, []);
  assert.equal(await syncAnnouncementsOnLoad(api, data, OPTS), data);
  const first = await syncAnnouncementsOnLoad(fakeApi(() => ({ revision: 6 })), response(), OPTS);
  const again = fakeApi(() => assert.fail('must not write twice'));
  assert.equal(await syncAnnouncementsOnLoad(again, first, OPTS), first);
});

test('a conflict refetches and retries against the new revision, a bounded number of times', async () => {
  const api = fakeApi(
    (n) => {
      if (n === 1) return { conflict: true as const };
      return { revision: 10 };
    },
    () => response(9, [announcement], base({ budgets: { '2025-08': 1 } })),
  );
  const out = await syncAnnouncementsOnLoad(api, response(), OPTS);
  assert.equal(api.calls.put.length, 2);
  assert.equal(api.calls.put[1].revision, 9);
  assert.equal(out.revision, 10);
  assert.equal(out.portfolio.budgets['2025-08'], 1);

  const stuck = fakeApi(() => ({ conflict: true as const }), () => response(9));
  const result = await syncAnnouncementsOnLoad(stuck, response(), OPTS);
  assert.equal(stuck.calls.put.length, 3);
  assert.equal(stuck.calls.get, 3);
  assert.equal(result.revision, 9, 'keeps the freshest copy it saw');
});

test('other failures leave the loaded data untouched and never throw', async () => {
  const data = response();
  const offline = fakeApi(() => { throw new Error('Could not reach Sipwise.'); });
  assert.equal(await syncAnnouncementsOnLoad(offline, data, OPTS), data);
  assert.equal(offline.calls.put.length, 1);
  const refetchFails = fakeApi(() => ({ conflict: true as const }), () => { throw new Error('boom'); });
  assert.equal(await syncAnnouncementsOnLoad(refetchFails, data, OPTS), data);
});

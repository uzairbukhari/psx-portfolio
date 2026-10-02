import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SYNC_ATTEMPTS, planAutoDividendUpdate, syncAutoDividends } from '../lib/dividend-sync.ts';

const NOW = '2025-08-30T10:00:00Z';
const AS_OF = '2025-08-30';
const buy = { id: 'b1', ticker: 'MEBL', kind: 'buy', date: '2025-01-02', shares: 100, price: 100, fees: 0, month: '2025-01', note: '' };
const pf = (extra = {}) => ({
  companies: [{ ticker: 'MEBL', name: 'Meezan', sector: 'Banks', target: 0, approved: true, screenDate: '', note: '', faceValue: 10 }],
  trades: [buy], quotes: {}, budgets: {}, dividendTrackingFrom: '2025-01-01', ...extra,
});
const ann = (extra = {}) => ({
  ticker: 'MEBL', announcedOn: '2025-08-13', period: '30/06/2025(HYR)', details: '70%(ii) (D)', kind: 'cash',
  percent: 70, perShareRs: null, bookClosureStart: '2025-08-27', bookClosureEnd: '2025-08-28', ...extra,
});

test('planAutoDividendUpdate books an expected dividend and its alert, without touching the input', () => {
  const p = pf();
  const update = planAutoDividendUpdate(p, [ann()], NOW, AS_OF);
  assert.ok(update);
  assert.equal(update.pending.length, 1);
  assert.equal(update.pending[0].source, 'auto');
  assert.equal(update.pending[0].status, 'expected');
  assert.equal(update.next.dividends.length, 1);
  assert.equal(update.next.notifications[0].id, 'div:psx:MEBL:2025-08-27:2025-08-13');
  assert.equal(p.dividends, undefined);
  assert.equal(p.notifications, undefined);
});

test('planAutoDividendUpdate announces upcoming payouts without booking them', () => {
  const update = planAutoDividendUpdate(pf(), [ann({ bookClosureStart: '2025-09-10', bookClosureEnd: '2025-09-11' })], NOW, AS_OF);
  assert.ok(update);
  assert.equal(update.pending.length, 0);
  assert.equal(update.notifications[0].kind, 'payout-announced');
});

test('planAutoDividendUpdate returns null when nothing is new (so nothing is written)', () => {
  assert.equal(planAutoDividendUpdate(pf(), [], NOW, AS_OF), null);
  const first = planAutoDividendUpdate(pf(), [ann()], NOW, AS_OF);
  assert.equal(planAutoDividendUpdate(first.next, [ann()], NOW, AS_OF), null);
  // A company that is not held produces no news.
  assert.equal(planAutoDividendUpdate(pf(), [ann({ ticker: 'LUCK' })], NOW, AS_OF), null);
});

test('the first load sets the tracking date once and voids earlier unconfirmed auto dividends', () => {
  const old = { id: 'auto-x', ticker: 'MEBL', date: '2025-03-01', source: 'auto', status: 'expected', externalId: 'psx:MEBL:2025-03-01:2025-02-20', perShare: 1, grossAmount: 100, note: '' };
  const p = pf({ dividendTrackingFrom: undefined, dividends: [old] });
  const update = planAutoDividendUpdate(p, [], NOW, AS_OF);
  assert.ok(update);
  assert.equal(update.next.dividendTrackingFrom, AS_OF);
  assert.deepEqual(update.voided.map((d) => d.id), ['auto-x']);
  assert.equal(update.next.dividends[0].voided, true);
  assert.equal(p.dividends[0].voided, undefined);
  assert.equal(planAutoDividendUpdate(update.next, [], NOW, AS_OF), null);
});

const io = (script) => {
  const calls = { save: [], reload: 0 };
  return {
    calls,
    save: async (portfolio, revision) => {
      calls.save.push({ portfolio, revision });
      return script.save(calls.save.length, revision);
    },
    reload: async () => {
      calls.reload++;
      return script.reload?.(calls.reload) ?? null;
    },
  };
};

test('syncAutoDividends saves once at the loaded revision and returns the new one', async () => {
  const x = io({ save: (_n, rev) => ({ revision: rev + 1 }) });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 7 }, [ann()], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'saved');
  assert.equal(r.revision, 8);
  assert.equal(x.calls.save.length, 1);
  assert.equal(x.calls.save[0].revision, 7);
  assert.equal(r.portfolio.dividends.length, 1);
  assert.equal(r.update.pending.length, 1);
});

test('syncAutoDividends does not write when there is nothing new', async () => {
  const x = io({ save: () => assert.fail('must not save') });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 3 }, [], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'nothing');
  assert.equal(r.revision, 3);
  assert.equal(x.calls.save.length, 0);
  assert.equal(x.calls.reload, 0);
});

test('on a 409 it reloads and retries against the fresh revision', async () => {
  const fresh = pf({ budgets: { '2025-08': 5000 } });
  const x = io({
    save: (n, rev) => (n === 1 ? { conflict: true } : { revision: rev + 1 }),
    reload: () => ({ portfolio: fresh, revision: 12 }),
  });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 11 }, [ann()], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'saved');
  assert.equal(x.calls.save.length, 2);
  assert.equal(x.calls.save[1].revision, 12);
  assert.equal(x.calls.save[1].portfolio.budgets['2025-08'], 5000);
  assert.equal(r.revision, 13);
});

test('a reload that already contains the update ends without a second write', async () => {
  const already = planAutoDividendUpdate(pf(), [ann()], NOW, AS_OF).next;
  const x = io({ save: () => ({ conflict: true }), reload: () => ({ portfolio: already, revision: 20 }) });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 19 }, [ann()], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'nothing');
  assert.equal(r.revision, 20);
  assert.equal(r.portfolio, already);
  assert.equal(x.calls.save.length, 1);
});

test('persistent conflicts stop after the bounded number of attempts', async () => {
  const x = io({ save: () => ({ conflict: true }), reload: () => ({ portfolio: pf(), revision: 50 }) });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 1 }, [ann()], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'gave-up');
  assert.equal(x.calls.save.length, MAX_SYNC_ATTEMPTS);
  assert.equal(x.calls.reload, MAX_SYNC_ATTEMPTS);
  assert.equal(r.revision, 50);
  const y = io({ save: () => ({ conflict: true }), reload: () => ({ portfolio: pf(), revision: 5 }) });
  await syncAutoDividends({ portfolio: pf(), revision: 1 }, [ann()], y, { maxAttempts: 2, now: () => NOW, asOf: AS_OF });
  assert.equal(y.calls.save.length, 2);
});

test('a failed reload gives up without retrying', async () => {
  const x = io({ save: () => ({ conflict: true }), reload: () => null });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 1 }, [ann()], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'gave-up');
  assert.equal(x.calls.save.length, 1);
  assert.equal(r.revision, 1);
});

test('a save error is reported, not thrown, and keeps the loaded state', async () => {
  const x = io({ save: () => { throw new Error('offline'); } });
  const r = await syncAutoDividends({ portfolio: pf(), revision: 4 }, [ann()], x, { now: () => NOW, asOf: AS_OF });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /offline/);
  assert.equal(r.revision, 4);
});

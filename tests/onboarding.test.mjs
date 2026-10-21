import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checklistItems,
  checklistProgress,
  parseOnboarding,
  showChecklist,
  withDoneDay,
  ONBOARDING_VERSION,
} from '../lib/onboarding.ts';

const blank = () => parseOnboarding(null);
const none = { hasHolding: false, hasSipBudget: false };

test('a blank or broken stored state is a fresh blank', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{"v":99}']) {
    const s = parseOnboarding(raw);
    assert.equal(s.v, ONBOARDING_VERSION);
    assert.deepEqual(s.ticks, {});
    assert.equal(s.fresh, undefined);
  }
});

test('parse keeps only known fields', () => {
  const s = parseOnboarding(JSON.stringify({ v: 1, fresh: '2026-10-21', hidden: true, ticks: { tax: true, backup: 1, nope: true }, junk: 1 }));
  assert.deepEqual(s, { v: 1, fresh: '2026-10-21', hidden: true, ticks: { tax: true } });
});

test('checklist: vault is always done, the rest follow data and ticks', () => {
  const items = checklistItems(blank(), none);
  assert.deepEqual(items.map((i) => i.id), ['vault', 'first_holding', 'tax', 'backup', 'sip_budget', 'insights']);
  assert.deepEqual(items.map((i) => i.done), [true, false, false, false, false, false]);
  const p = checklistProgress(items);
  assert.equal(p.done, 1);
  assert.equal(p.total, 6);
  assert.equal(p.next.id, 'first_holding');

  const state = { ...blank(), ticks: { tax: true, backup: true } };
  const later = checklistItems(state, { hasHolding: true, hasSipBudget: true });
  assert.equal(checklistProgress(later).next.id, 'insights');
});

test('checklist shows only on a fresh device, until hidden', () => {
  const items = checklistItems(blank(), none);
  assert.equal(showChecklist(blank(), items, '2026-10-21'), false);
  const fresh = { ...blank(), fresh: '2026-10-21' };
  assert.equal(showChecklist(fresh, items, '2026-10-21'), true);
  assert.equal(showChecklist({ ...fresh, hidden: true }, items, '2026-10-21'), false);
});

test('checklist stays through the day it was finished, then leaves', () => {
  const state = { ...blank(), fresh: '2026-10-01', ticks: { tax: true, backup: true, insights: true } };
  const items = checklistItems(state, { hasHolding: true, hasSipBudget: true });
  assert.equal(checklistProgress(items).next, null);
  const stamped = withDoneDay(state, items, '2026-10-21');
  assert.equal(stamped.doneOn, '2026-10-21');
  assert.equal(withDoneDay(stamped, items, '2026-10-30').doneOn, '2026-10-21');
  assert.equal(showChecklist(stamped, items, '2026-10-21'), true);
  assert.equal(showChecklist(stamped, items, '2026-10-22'), false);
  // Not finished: nothing is stamped.
  assert.equal(withDoneDay(blank(), checklistItems(blank(), none), '2026-10-21').doneOn, undefined);
});

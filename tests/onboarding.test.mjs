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

import { shouldOfferTour } from '../lib/onboarding.ts';
import { stepsToShow, TOUR_STEPS, TOUR_STEP_IDS } from '../lib/tour-steps.ts';
import { EVENT_CATALOG } from '../lib/analytics-events.ts';

test('tour is offered once, to a fresh device with something to look at', () => {
  const facts = { hasHolding: true, onHoldings: true };
  const fresh = { ...blank(), fresh: '2026-10-21' };
  assert.equal(shouldOfferTour(fresh, facts), true);
  assert.equal(shouldOfferTour(blank(), facts), false);
  assert.equal(shouldOfferTour({ ...fresh, tour: 'declined' }, facts), false);
  assert.equal(shouldOfferTour(fresh, { ...facts, hasHolding: false }), false);
  assert.equal(shouldOfferTour(fresh, { ...facts, onHoldings: false }), false);
});

test('tour outcome survives a round trip and junk is dropped', () => {
  assert.equal(parseOnboarding(JSON.stringify({ v: 1, tour: 'skipped', ticks: {} })).tour, 'skipped');
  assert.equal(parseOnboarding(JSON.stringify({ v: 1, tour: 'bogus', ticks: {} })).tour, undefined);
});

test('tour steps: ids match the analytics catalog and missing targets are skipped', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), [...TOUR_STEP_IDS]);
  const allowed = EVENT_CATALOG.tour_step_viewed.step;
  for (const id of TOUR_STEP_IDS) assert.ok(allowed.includes(id));
  const steps = stepsToShow((id) => id !== 'bell', (href) => href !== '/sip');
  assert.ok(!steps.some((s) => s.id === 'bell'));
  const pages = steps.find((s) => s.id === 'pages');
  assert.ok(pages.items.some((i) => i.name === 'Insights'));
  assert.ok(!pages.items.some((i) => i.name === 'Monthly Picks'));
  for (const s of TOUR_STEPS) assert.ok(s.body || s.items?.length, s.id);
});

import { PAGE_TIPS, TIP_IDS, tipVisible } from '../lib/onboarding.ts';

test('page tips wait for the tour, hide once dismissed and come back on request', () => {
  const fresh = { ...blank(), fresh: '2026-10-21' };
  assert.equal(tipVisible(fresh, 'insights'), false, 'not before the tour is dealt with');
  assert.equal(tipVisible({ ...fresh, tour: 'skipped' }, 'insights'), true);
  assert.equal(tipVisible({ ...fresh, tour: 'declined', tips: { insights: true } }, 'insights'), false);
  assert.equal(tipVisible({ ...fresh, tour: 'declined', tips: { insights: true } }, 'activity'), true);
  assert.equal(tipVisible(blank(), 'insights'), false, 'an existing user sees nothing by default');
  assert.equal(tipVisible({ ...blank(), tipsOn: true }, 'picks'), true);
});

test('every tip has copy and is allowed by the analytics catalog', () => {
  const allowed = EVENT_CATALOG.tip_dismissed.tip;
  for (const id of TIP_IDS) {
    assert.ok(PAGE_TIPS[id].title && PAGE_TIPS[id].text, id);
    assert.ok(allowed.includes(id), id);
  }
  const s = parseOnboarding(JSON.stringify({ v: 1, ticks: {}, tips: { insights: true, nope: true }, tipsOn: true }));
  assert.deepEqual(s.tips, { insights: true });
  assert.equal(s.tipsOn, true);
});

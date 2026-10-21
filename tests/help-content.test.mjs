import test from 'node:test';
import assert from 'node:assert/strict';
import { HELP_FAQ, HELP_SHORTCUTS } from '../lib/help-content.ts';
import { EVENT_CATALOG, validateEvent } from '../lib/analytics-events.ts';

test('help answers have unique ids and real text', () => {
  const ids = HELP_FAQ.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of HELP_FAQ) {
    assert.ok(q.question.trim().length > 10, q.id);
    assert.ok(q.answer.trim().length > 40, q.id);
  }
  assert.ok(HELP_SHORTCUTS.length >= 3);
});

test('help_opened is a closed-enum event', () => {
  assert.ok(EVENT_CATALOG.help_opened);
  assert.ok(validateEvent({ event: 'help_opened', props: { item: 'panel' } }));
  assert.equal(validateEvent({ event: 'help_opened', props: { item: 'anything else' } }), null);
});

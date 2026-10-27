import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickEpisode, captionFor } from '../scripts/social-tips-render.mjs';

const config = JSON.parse(readFileSync(new URL('../scripts/social-tips-episodes.json', import.meta.url), 'utf8'));

test('every episode has a voice-over for each slide plus the closing one', () => {
  const ids = new Set();
  for (const ep of config.episodes) {
    assert.ok(!ids.has(ep.id), `duplicate ${ep.id}`);
    ids.add(ep.id);
    assert.equal(ep.spoken.length, ep.slides.length + 1, ep.id);
    assert.ok(ep.caption && ep.topic, ep.id);
  }
});

test('copy stays educational: no promises and no stock tips', () => {
  const text = JSON.stringify(config.episodes).toLowerCase();
  for (const word of ['guaranteed return', 'risk-free returns', 'sure profit', 'must buy', 'double your money']) assert.ok(!text.includes(word), word);
});

test('the risk line is on every caption and the pick cycles daily', () => {
  assert.match(captionFor(config.episodes[0], config.riskLine), /not investment advice/);
  assert.equal(pickEpisode(config, config.start).id, config.episodes[0].id);
  assert.equal(pickEpisode(config, '2026-10-28').id, config.episodes[1].id);
  assert.equal(pickEpisode(config, '2026-11-07').id, config.episodes[0].id);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Android chart colours (android/core/designsystem/.../ChartColors.kt) must equal the web tokens, so a chart looks
// the same on both. Web: app/redesign.css (classic, per theme) and app/globals.css (vibrant and colour-blind palettes).
const kt = readFileSync('android/core/designsystem/src/main/kotlin/app/sipwise/designsystem/ChartColors.kt', 'utf8');
const redesign = readFileSync('app/redesign.css', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');

const hexes = (text) => [...text.matchAll(/0xFF([0-9A-F]{6})/g)].map((m) => `#${m[1].toLowerCase()}`);
const kotlinCats = (name) => {
  const m = kt.match(new RegExp(`private val ${name} =[\\s\\S]*?cat = ints\\(([^)]*)\\)`));
  return m ? hexes(m[1]) : [];
};
const cssCats = (css, selector) => {
  const line = css.split('\n').find((l) => l.includes(selector));
  assert.ok(line, `no CSS rule for ${selector}`);
  return [1, 2, 3, 4, 5, 6, 7].map((n) => line.match(new RegExp(`--cat-${n}:(#[0-9a-fA-F]{6})`))?.[1].toLowerCase());
};

test('classic chart colours match the web light and dark themes', () => {
  assert.deepEqual(kotlinCats('ClassicLight'), cssCats(redesign, 'html:root[data-theme=light]'));
  assert.deepEqual(kotlinCats('ClassicDark'), cssCats(redesign, 'html:root[data-theme=dark]'));
});

test('vibrant and colour-blind chart colours match the web palettes', () => {
  assert.deepEqual(kotlinCats('VibrantLight'), cssCats(globals, 'html[data-chart-palette=vibrant],[data-chart-palette=vibrant]{'));
  assert.deepEqual(kotlinCats('VibrantDark'), cssCats(globals, 'html[data-chart-palette=vibrant]:is('));
  assert.deepEqual(kotlinCats('AccessibleLight'), cssCats(globals, 'html[data-chart-palette=accessible],[data-chart-palette=accessible]{'));
  assert.deepEqual(kotlinCats('AccessibleDark'), cssCats(globals, 'html[data-chart-palette=accessible]:is('));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NON_TEXT_PAIRS, TEXT_PAIRS, contrast, darkPalette, lightPalette, palettes } from './palette.ts';
import { APPEARANCES, parseAppearance, resolveScheme } from './appearance.ts';

test('contrast helper matches known WCAG values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: every text pair in the token table is at least 4.5:1`, () => {
    const p = palettes[scheme];
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(p[fg] as string, p[bg] as string);
      assert.ok(ratio >= 4.5, `${scheme} ${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${scheme}: ink is readable on every ticker tint`, () => {
    const p = palettes[scheme];
    for (const tint of p.tints) assert.ok(contrast(p.ink, tint) >= 4.5, `${scheme} ink on ${tint}`);
  });

  test(`${scheme}: control borders reach 3:1 against their surfaces`, () => {
    const p = palettes[scheme];
    for (const [fg, bg] of NON_TEXT_PAIRS) {
      const ratio = contrast(p[fg] as string, p[bg] as string);
      assert.ok(ratio >= 3, `${scheme} ${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
    }
  });
}

test('the design-spec headline ratios hold', () => {
  assert.ok(contrast(lightPalette.ink, lightPalette.bg) > 15);
  assert.ok(contrast(darkPalette.ink, darkPalette.surface) > 15);
  assert.ok(contrast(lightPalette.primary, lightPalette.surface) >= 6.5);
  assert.ok(contrast(darkPalette.onPrimary, darkPalette.primary) >= 7.5);
});

test('both palettes define the same tokens as hex or rgba strings', () => {
  assert.deepEqual(Object.keys(lightPalette).sort(), Object.keys(darkPalette).sort());
  for (const [key, value] of Object.entries(lightPalette)) {
    if (key === 'tints') continue;
    assert.match(String(value), /^(#[0-9a-f]{6}|rgba\()/i, key);
  }
});

test('appearance resolves to a scheme', () => {
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('dark', 'light'), 'dark');
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', 'light'), 'light');
  assert.equal(resolveScheme('system', null), 'light');
  assert.equal(resolveScheme('system', undefined), 'light');
  assert.equal(resolveScheme('system', 'unspecified'), 'light');
});

test('stored appearance parses, defaulting to system', () => {
  assert.equal(parseAppearance('dark'), 'dark');
  assert.equal(parseAppearance('light'), 'light');
  assert.equal(parseAppearance('system'), 'system');
  assert.equal(parseAppearance(null), 'system');
  assert.equal(parseAppearance('purple'), 'system');
  assert.deepEqual(APPEARANCES.map((a) => a.key), ['system', 'light', 'dark']);
});

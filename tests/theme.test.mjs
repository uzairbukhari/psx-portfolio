import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  DEFAULT_PREFERENCE,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  THEME_META,
  applyTheme,
  parseThemePreference,
  resolveTheme,
  themeInitScript,
} from '../lib/theme.ts';
import { validateEvent } from '../lib/analytics-events.ts';

test('dark is the default and unknown values fall back to it', () => {
  assert.equal(DEFAULT_PREFERENCE, 'dark');
  for (const bad of [null, undefined, '', 'blue', '__proto__', 7])
    assert.equal(parseThemePreference(bad), 'dark');
  for (const ok of ['light', 'dark', 'midnight', 'paper', 'system'])
    assert.equal(parseThemePreference(ok), ok);
});

test('system resolves by OS preference, explicit themes win', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', null), 'light');
  assert.equal(resolveTheme('paper', true), 'paper');
});

function run(stored, osDark, throwing = false) {
  const attrs = {};
  const style = {};
  const meta = {
    content: '',
    setAttribute(k, v) {
      this[k] = v;
    },
  };
  const ctx = {
    localStorage: {
      getItem() {
        if (throwing) throw new Error('blocked');
        return stored;
      },
    },
    window: { matchMedia: () => ({ matches: osDark }) },
    document: {
      documentElement: {
        setAttribute(k, v) {
          attrs[k] = v;
        },
        style,
      },
      querySelector: () => meta,
    },
  };
  ctx.window.localStorage = ctx.localStorage;
  vm.runInNewContext(themeInitScript(), ctx);
  return {
    theme: attrs['data-theme'],
    scheme: style.colorScheme,
    color: meta.content,
  };
}

test('init script applies the stored theme before paint', () => {
  assert.deepEqual(run('midnight', false), {
    theme: 'midnight',
    scheme: 'dark',
    color: '#000000',
  });
  assert.deepEqual(run('paper', true), {
    theme: 'paper',
    scheme: 'light',
    color: THEME_META.paper.bg,
  });
  assert.equal(run('system', true).theme, 'dark');
  assert.equal(run('system', false).theme, 'light');
  assert.equal(run(null, true).theme, 'dark');
  assert.equal(run('nonsense', true).theme, 'dark');
  assert.equal(run(null, false, true).theme, 'dark'); // storage blocked (private mode)
});

test('init script constants match lib/theme.ts for every theme', () => {
  for (const id of Object.keys(THEME_META)) {
    assert.deepEqual(run(id, false), {
      theme: id,
      scheme: THEME_META[id].scheme,
      color: THEME_META[id].bg,
    });
  }
  assert.ok(themeInitScript().includes(`'${THEME_STORAGE_KEY}'`));
  assert.ok(themeInitScript().includes(`d='${DEFAULT_THEME}'`));
});

test('applyTheme sets attribute, native scheme and browser colour', () => {
  const attrs = {};
  const style = {};
  const meta = {
    setAttribute(k, v) {
      this[k] = v;
    },
  };
  applyTheme('dark', {
    documentElement: {
      setAttribute: (k, v) => {
        attrs[k] = v;
      },
      style,
    },
    querySelector: () => meta,
  });
  assert.equal(attrs['data-theme'], 'dark');
  assert.equal(style.colorScheme, 'dark');
  assert.equal(meta.content, '#05070d');
});

test('every theme has chrome metadata and a swatch', () => {
  for (const t of THEMES) {
    assert.ok(THEME_META[t.id]);
    assert.equal(t.swatch.length, 3);
  }
});

test('theme_changed accepts every theme and rejects others', () => {
  for (const theme of [...THEMES.map((t) => t.id), 'system'])
    assert.ok(validateEvent({ event: 'theme_changed', props: { theme } }));
  assert.equal(
    validateEvent({ event: 'theme_changed', props: { theme: 'sepia' } }),
    null,
  );
});

// Each theme block in globals.css must define every token the first (light) block defines, so a theme can't ship half-done.
import fs from 'node:fs';
test('every theme defines the full token set', () => {
  const css = fs.readFileSync(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );
  const tokens = (block) =>
    new Set([...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  const block = (sel) => css.split('\n').find((l) => l.startsWith(sel)) ?? '';
  const light = tokens(block('html[data-theme=light]'));
  assert.ok(light.size > 60);
  for (const id of ['dark', 'midnight', 'paper']) {
    const have = tokens(block(`html[data-theme=${id}]`));
    const missing = [...light].filter((t) => !have.has(t));
    assert.deepEqual(missing, [], `${id} is missing ${missing.join(', ')}`);
  }
});

import {
  CHART_PALETTES,
  CHART_PALETTE_STORAGE_KEY,
  applyChartPalette,
  parseChartPalette,
} from '../lib/chart-palette.ts';

test('chart palettes parse, apply, and each has colours in globals.css', () => {
  assert.equal(parseChartPalette('nope'), 'default');
  for (const p of CHART_PALETTES) assert.equal(parseChartPalette(p.id), p.id);
  const attrs = {};
  const root = {
    setAttribute: (k, v) => {
      attrs[k] = v;
    },
    removeAttribute: (k) => {
      delete attrs[k];
    },
  };
  applyChartPalette('vibrant', root);
  assert.equal(attrs['data-chart-palette'], 'vibrant');
  applyChartPalette('default', root);
  assert.equal(attrs['data-chart-palette'], undefined);
  const css = fs.readFileSync(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );
  for (const p of CHART_PALETTES)
    for (let n = 1; n <= 7; n++)
      assert.match(
        css,
        new RegExp(`\\[data-chart-palette=${p.id}\\][^}]*--cat-${n}:`),
        `${p.id} --cat-${n}`,
      );
});

test('init script restores a stored chart palette and ignores unknown ones', () => {
  const run = (value) => {
    const attrs = {};
    const ctx = {
      localStorage: {
        getItem: (k) => (k === CHART_PALETTE_STORAGE_KEY ? value : null),
      },
      window: { matchMedia: () => ({ matches: false }) },
      document: {
        documentElement: {
          setAttribute(k, v) {
            attrs[k] = v;
          },
          style: {},
        },
        querySelector: () => null,
      },
    };
    vm.runInNewContext(themeInitScript(), ctx);
    return attrs['data-chart-palette'];
  };
  assert.equal(run('vibrant'), 'vibrant');
  assert.equal(run('accessible'), 'accessible');
  assert.equal(run('default'), undefined);
  assert.equal(run('bogus'), undefined);
});

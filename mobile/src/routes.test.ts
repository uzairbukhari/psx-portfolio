// Guards the route map: every path renamed by the Steady Steps navigation still exists and redirects to its new home,
// so saved links, deep links and notification routes keep working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = (path: string) => new URL(`../app/${path}`, import.meta.url);

const REDIRECTS: [file: string, target: RegExp][] = [
  ['(tabs)/sip.tsx', /href="\/plan"/],
  ['(tabs)/alerts.tsx', /href="\/inbox"/],
  ['(tabs)/account.tsx', /href="\/more"/],
  ['reports.tsx', /pathname: '\/portfolio', params: \{ segment: 'insights' \}/],
  ['picks.tsx', /pathname: '\/plan', params: \{ mode: 'picks' \}/],
];

for (const [file, target] of REDIRECTS)
  test(`legacy route ${file} redirects to its new home`, () => {
    const source = readFileSync(app(file), 'utf8');
    assert.match(source, /<Redirect /);
    assert.match(source, target);
  });

test('the four tabs, inbox, more and the company page exist', () => {
  for (const file of ['(tabs)/index.tsx', '(tabs)/portfolio.tsx', '(tabs)/plan.tsx', '(tabs)/activity.tsx', 'inbox.tsx', 'more.tsx', 'company/[ticker].tsx', 'import.tsx', 'targets.tsx', 'received.tsx', 'quote.tsx', 'transaction.tsx'])
    assert.ok(existsSync(app(file)), file);
});

test('the tab layout lists the four tabs and hides the legacy ones', () => {
  const layout = readFileSync(app('(tabs)/_layout.tsx'), 'utf8');
  for (const name of ['index', 'portfolio', 'plan', 'activity']) assert.match(layout, new RegExp(`name="${name}" options=\\{\\{ title`));
  for (const name of ['sip', 'alerts', 'account']) assert.match(layout, new RegExp(`name="${name}" options=\\{\\{ href: null`));
});

test('Add transaction picks the SIP month instead of typing it, and closes without a blank screen', () => {
  const source = readFileSync(app('transaction.tsx'), 'utf8');
  assert.match(source, /<MonthPicker /);
  assert.doesNotMatch(source, /YYYY-MM\)"/);
  assert.match(source, /router\.canGoBack\(\)/);
  assert.match(source, /Keyboard\.dismiss\(\)/);
  assert.doesNotMatch(source, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
});

test('both privacy covers use the self-healing foreground check, so one cannot get stuck over the app', () => {
  for (const file of ['../src/auth/BiometricLock.tsx', '../src/vault/VaultProvider.tsx']) {
    const source = readFileSync(new URL(file, app('x')), 'utf8');
    assert.match(source, /useAppActive\(\)/, file);
    assert.doesNotMatch(source, /setAppActive/, file);
  }
  assert.match(readFileSync(new URL('../src/auth/app-active.ts', app('x')), 'utf8'), /setInterval/);
});

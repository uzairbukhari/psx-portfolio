import { expect, test } from './fixtures';

// Every top-level page opens with its content (the seed keeps the vault unlocked in this tab across navigations).
const PAGES: [string, RegExp][] = [
  ['/reports', /priced market value/i],
  ['/insights', /priced market value/i],
  ['/plan', /Your staircase/i],
  ['/sip', /Where should this month/],
  ['/monthly-picks', /Where should this month/],
  ['/activity', /Every trade, dividend and asset entry/],
  ['/research-desk', /Research queue & dossiers/],
  ['/ai-lab', /Holdings review/],
  ['/settings', /Manage your account, tax status and portfolio data/],
  ['/notifications', /Everything from your portfolio/],
];

for (const [path, marker] of PAGES)
  test(`${path} renders`, async ({ app }) => {
    await app.goto(path);
    await expect(app.getByText(marker).first()).toBeVisible({ timeout: 60_000 });
    await expect(app.getByText(/something went wrong|application error/i)).toHaveCount(0);
  });

test('reports cover stocks, metals, mutual funds and foreign currency', async ({ app }) => {
  await app.goto('/reports');
  for (const tab of ['Overview', 'Stocks', 'Gold & silver', 'Funds', 'Currency']) await expect(app.getByRole('tab', { name: tab }).or(app.getByRole('button', { name: tab, exact: true })).first()).toBeVisible();
});

test('settings shows the super admin sections', async ({ app }) => {
  await app.goto('/settings');
  await expect(app.getByText('Super admin').first()).toBeVisible();
  for (const section of ['Portfolios', 'Security', 'Sync dividends', 'Research AI']) await expect(app.getByText(section, { exact: true }).first()).toBeVisible();
});

test('theme switch applies to the page', async ({ app }) => {
  await app.goto('/settings');
  await app.getByText('Dark', { exact: true }).first().click();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await app.getByText('Light', { exact: true }).first().click();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('sidebar unpins to a hover rail and remembers it', async ({ app }) => {
  const nav = app.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /Holdings/ })).toBeVisible();
  await app.getByRole('button', { name: 'Unpin menu' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-side', 'auto');
  await app.reload();
  await expect(app.locator('html')).toHaveAttribute('data-side', 'auto');
  await app.getByRole('button', { name: 'Pin menu' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-side', 'pinned');
});

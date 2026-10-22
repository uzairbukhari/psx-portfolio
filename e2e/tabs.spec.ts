import { expect, test } from './fixtures';

// Every top-level page opens with its content (the seed keeps the vault unlocked in this tab across navigations).
const PAGES: [string, RegExp][] = [
  ['/reports', /net worth/i],
  ['/insights', /net worth/i],
  ['/plan', /Your staircase/i],
  ['/sip-tracker', /A plan you can follow every month|This month’s plan/],
  ['/future', /Future you|Set up your SIP first/],
  ['/zakat', /if your zakat day were today|When does your zakat year start/],
  ['/sip', /Where should .* go this month/],
  ['/monthly-picks', /Where should .* go this month/],
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
  for (const tab of ['Summary', 'Stocks', 'Gold & silver', 'Funds & plans', 'Currency']) await expect(app.getByRole('tab', { name: tab }).or(app.getByRole('button', { name: tab, exact: true })).first()).toBeVisible();
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

test('sidebar collapses to an icon rail and remembers it', async ({ app }) => {
  const nav = app.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /Holdings/ })).toBeVisible();
  await app.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-side', 'auto');
  await app.reload();
  await expect(app.locator('html')).toHaveAttribute('data-side', 'auto');
  await app.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-side', 'pinned');
});

test('account menu opens beside the sidebar, switches theme, and closes with Escape', async ({ app }) => {
  for (const mode of ['pinned', 'auto']) {
    await app.evaluate((m) => localStorage.setItem('sipwise.sidebar', m), mode);
    await app.reload();
    await expect(app.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
    await app.locator('.side-user .account-trigger').click();
    const menu = app.locator('.account-menu');
    await expect(menu).toBeVisible();
    const side = await app.locator('.side').boundingBox();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(side!.x + side!.width);
    await app.getByRole('radio', { name: 'Light' }).click();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'light');
    await app.getByRole('radio', { name: 'Dark' }).click();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
    await app.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  await app.evaluate(() => localStorage.setItem('sipwise.sidebar', 'pinned'));
});

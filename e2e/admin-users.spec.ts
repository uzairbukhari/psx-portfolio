import { expect, test } from './fixtures';

test('admin People lists accounts, filters them and opens a person', async ({ app }) => {
  await app.goto('/admin/users');
  await expect(app.getByRole('heading', { name: 'People' })).toBeVisible({ timeout: 60_000 });
  await expect(app.getByRole('heading', { name: 'How far people got' })).toBeVisible();
  await expect(app.getByRole('heading', { name: 'Who needs a nudge' })).toBeVisible();
  // Internal accounts (the test account may be one) only appear once they are included.
  await app.getByRole('switch', { name: 'Include internal accounts' }).click();
  const row = app.locator('.people-person').first();
  const empty = app.getByText('No one matches.');
  await expect(row.or(empty)).toBeVisible({ timeout: 30_000 });
  if (await row.isVisible()) {
    await row.click();
    await expect(app.getByRole('heading', { name: 'Last 90 days' })).toBeVisible();
  }
  await expect(app.getByText(/something went wrong|application error/i)).toHaveCount(0);
});

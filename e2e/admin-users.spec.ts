import { expect, test } from './fixtures';

test('admin People lists accounts, filters them and opens a person', async ({ app }) => {
  await app.goto('/admin/users');
  await expect(app.getByRole('heading', { name: 'People' })).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText('How far people got')).toBeVisible();
  await expect(app.getByText('Who needs a nudge')).toBeVisible();
  // The test account is internal, so it only appears once internal accounts are included.
  await app.getByLabel('Include internal accounts').click();
  const row = app.locator('.people-person').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(app.getByText('Last 90 days')).toBeVisible();
  await expect(app.getByText(/something went wrong|application error/i)).toHaveCount(0);
});

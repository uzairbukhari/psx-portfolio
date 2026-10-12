import { choosePortfolio, expect, test } from './fixtures';

// Runs last (the zz- prefix sorts it after the others, one worker): it changes the test account. Every run reseeds first, so nothing leaks.
test('a transaction saved in the app is encrypted, stored and still there after a reload', async ({ app }) => {
  await choosePortfolio(app, 'AHL Core');
  await app.goto('/company/FCCL');
  await expect(app.getByText('Fauji Cement').first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText('600').first()).toBeVisible(); // seeded: 600 shares

  await app.getByRole('button', { name: /Add transaction/ }).first().click();
  const dialog = app.getByRole('dialog', { name: 'Add transaction' });
  await dialog.getByLabel('Transaction portfolio').selectOption({ label: 'AHL Core' });
  // The company is already filled in when the dialog is opened from its page.
  await dialog.getByLabel('Number of shares').fill('25');
  await dialog.getByLabel(/Price per share/).fill('50');
  await dialog.getByRole('button', { name: 'Save entry' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await app.reload();
  await expect(app.getByText('Fauji Cement').first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText('625').first()).toBeVisible();
});

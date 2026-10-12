import { choosePortfolio, expect, test } from './fixtures';

// Runs last (the zz- prefix sorts it after the others, one worker): it changes the test account. Every run reseeds first, so nothing leaks.
test('a transaction saved in the app is encrypted, stored and still there after a reload', async ({ app }) => {
  await choosePortfolio(app, 'AHL Core');
  await app.goto('/company/FCCL');
  await expect(app.getByText('Fauji Cement').first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText('600').first()).toBeVisible(); // seeded: 600 shares

  await app.getByRole('button', { name: /Add transaction/ }).first().click();
  const dialog = app.getByRole('dialog', { name: 'Add transaction' });
  // The dialog opens on the chosen portfolio with the company already filled in; picking a portfolio again would clear the company.
  await expect(dialog.getByLabel('Transaction portfolio')).toHaveValue(/.+/);
  await dialog.getByLabel('Number of shares').fill('25');
  await dialog.getByLabel(/Price per share/).fill('50');
  const failedCalls: string[] = [];
  const onResponse = (res: import('@playwright/test').Response) => {
    if (res.url().includes('/api/') && res.status() >= 400) failedCalls.push(`${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
  };
  app.on('response', onResponse);
  await dialog.getByRole('button', { name: 'Save entry' }).click();
  try {
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  } catch (error) {
    // Say why the save did not go through (validation or server message) instead of just "still visible".
    // The message can sit inside the dialog, in a page banner behind it, or in a toast.
    const messages = await app.locator('.notice, [role="alert"], [role="status"], [data-sonner-toast]').allInnerTexts();
    const shown = messages.map((m) => m.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
    throw new Error(`Saving the transaction did not close the dialog. Messages on the page: ${shown || '(none)'}. Failed API calls: ${failedCalls.join(', ') || '(none)'}`, { cause: error });
  } finally {
    app.off('response', onResponse);
  }

  await app.reload();
  await expect(app.getByText('Fauji Cement').first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText('625').first()).toBeVisible();
});

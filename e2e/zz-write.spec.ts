import { choosePortfolio, expect, test } from './fixtures';

// Runs last (the zz- prefix sorts it after the others, one worker): it changes the test account. Every run reseeds first, so nothing leaks.
test('a transaction saved in the app is encrypted, stored and still there after a reload', async ({ app }) => {
  await choosePortfolio(app, 'AHL Core');
  await app.goto('/company/FCCL');
  await expect(app.getByText('Fauji Cement').first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText('600').first()).toBeVisible(); // seeded: 600 shares

  await app.getByRole('button', { name: /Add transaction/ }).first().click();
  const dialog = app.getByRole('dialog', { name: 'Add transaction' });
  // Opened after a reload the app shows all portfolios, so the destination must be picked; picking one clears the company, so type it again.
  await dialog.getByLabel('Transaction portfolio').selectOption({ label: 'AHL Core' });
  const symbol = dialog.getByLabel('Company symbol');
  await symbol.fill('');
  await symbol.fill('FCCL');
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

test('a foreign currency purchase is saved with the public rate filled in and survives a reload', async ({ app }) => {
  await choosePortfolio(app, 'Savings & Gold');
  // Panels you open stay open in this browser, so only open it when an earlier spec left it folded.
  if (!(await app.getByRole('button', { name: 'Add currency' }).isVisible())) await app.getByRole('button', { name: /Foreign currency/ }).click();
  await app.getByRole('button', { name: 'Add currency' }).click();
  const dialog = app.getByRole('dialog', { name: 'Add foreign currency' });
  await dialog.getByLabel('Holding').selectOption({ label: 'Dollars at home' });
  await dialog.getByLabel('Amount (USD)').fill('100');
  // The rupees are filled in from today's rate (the open-market buying rate), and can be overwritten.
  await expect(dialog.getByLabel(/Rupees paid/)).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(app.getByText('650 USD')).toBeVisible();

  await app.reload();
  await choosePortfolio(app, 'Savings & Gold');
  // The panel was left open, and a panel you open stays open in this browser.
  await expect(app.getByText('650 USD')).toBeVisible({ timeout: 60_000 });
});

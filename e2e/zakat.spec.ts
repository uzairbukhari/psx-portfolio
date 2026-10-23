import { expect, test } from './fixtures';

// Zakat (Beta): the seeded account has a zakat book with a closed year, an open year and payments. Read-only checks here;
// the payment that is logged lives in the shared vault, so it is voided again at the end.
test('zakat: overview shows the estimate, payments and how it is worked out', async ({ app }) => {
  await app.goto('/zakat');
  await expect(app.getByRole('heading', { name: 'Zakat' }).first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText(/estimate, fixed on/i)).toBeVisible();
  await expect(app.getByRole('heading', { name: /How it.s worked out/ })).toBeVisible();
  await expect(app.getByRole('heading', { name: 'Payments this year' })).toBeVisible();
  await expect(app.getByText('Net zakatable wealth')).toBeVisible();
  await app.screenshot({ path: process.env.ZAKAT_SHOT ?? 'test-results/zakat.png', fullPage: true });
});

test('zakat: log a payment, then remove it', async ({ app }) => {
  await app.goto('/zakat');
  await expect(app.getByRole('heading', { name: 'Zakat' }).first()).toBeVisible({ timeout: 60_000 });
  await app.getByRole('button', { name: /Log a payment/ }).first().click();
  await app.getByLabel('Amount (Rs)').fill('1234');
  await app.getByRole('button', { name: 'Save payment' }).click();
  const row = app.getByRole('button', { name: /Edit payment of Rs 1,234/ });
  await expect(row).toBeVisible();
  await row.click();
  await app.getByRole('button', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0);
});

test('zakat: how it is counted opens and shows the rules', async ({ app }) => {
  await app.goto('/zakat');
  await app.getByRole('button', { name: /How it.s counted/ }).click();
  await expect(app.getByText('Shares and equity funds')).toBeVisible();
  await expect(app.getByText("What the app can't see")).toBeVisible();
});

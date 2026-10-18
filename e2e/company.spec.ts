import { expect, isLocal, test } from './fixtures';

test('company page: quote, position, chart and ledger', async ({ app }) => {
  await app.goto('/company/MEBL');
  await expect(app.getByText('Meezan Bank').first()).toBeVisible({ timeout: 60_000 });
  await expect(app.getByText(/Shares/i).first()).toBeVisible();
  await expect(app.getByText(/Price/).first()).toBeVisible();
  for (const range of ['1M', '1Y']) await expect(app.getByRole('button', { name: range, exact: true }).first()).toBeVisible();
  if (isLocal) await expect(app.getByText('520').first()).toBeVisible(); // 200 opening + 100 + 50 + ... from the seed
  await expect(app.getByText(/Dividends/).first()).toBeVisible();
});

test('a company that was sold out still opens', async ({ app }) => {
  await app.goto('/company/HUBC');
  await expect(app.getByText('Hub Power').first()).toBeVisible({ timeout: 60_000 });
});

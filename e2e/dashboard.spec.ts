import { expect, test, isLocal, pageText } from './fixtures';

test('All view totals every asset class across the four portfolios', async ({ app }) => {
  await expect(app.getByText(/Net worth/)).toBeVisible();
  await expect(app.getByText('4 portfolios')).toBeVisible();
  // The asset-mix donut is a canvas; its classes are listed beside it with the position count.
  const mix = app.getByRole('region', { name: 'Asset mix' });
  for (const label of ['Stocks', 'Gold', 'Silver', 'Savings plans', 'Mutual funds']) await expect(mix.getByText(label).first()).toBeVisible();
  await expect(app.getByText('Stocks by sector')).toBeVisible();
  for (const sector of ['Bank', 'Oil & Gas', 'Fertilizer', 'Cement', 'Technology']) await expect(app.getByText(sector, { exact: true }).first()).toBeVisible();
  const text = await pageText(app);
  for (const name of ['AHL Core', 'Finqalab', 'Savings & Gold']) expect(text).toContain(name);
});

test('the portfolio switcher lists all four portfolios, one of them locked', async ({ app }) => {
  const options = await app.locator('select').first().locator('option').allInnerTexts();
  expect(options).toEqual(['All', 'AHL Core', 'Finqalab', 'Savings & Gold', 'Empty · locked']);
});

test('unread notifications show on the bell', async ({ app }) => {
  await expect(app.getByRole('button', { name: /Notifications/ })).toContainText(isLocal ? '2' : /\d/);
  if (isLocal) await expect(app.getByText('Rs 8,117.95')).toBeVisible(); // dividends this tax year, from the seed
});

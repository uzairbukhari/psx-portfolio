import { choosePortfolio, expect, isLocal, pageText, test } from './fixtures';

test('AHL Core: holdings, market value and the sold-out company', async ({ app }) => {
  await choosePortfolio(app, 'AHL Core');
  await expect(app.getByText('Portfolio market value')).toBeVisible();
  await expect(app.getByText('13 holdings').first()).toBeVisible();
  if (isLocal) await expect(app.getByText('Rs 671,600').first()).toBeVisible();
});

test('Finqalab: a non-filer portfolio with its own holdings', async ({ app }) => {
  await choosePortfolio(app, 'Finqalab');
  await expect(app.getByText(/4 holdings/).first()).toBeVisible();
});

test('Savings & Gold: gold, savings plans and mutual funds each open', async ({ app }) => {
  await choosePortfolio(app, 'Savings & Gold');
  await expect(app.getByRole('button', { name: /Gold and Silver/ })).toContainText('3 held');
  await expect(app.getByRole('button', { name: /Savings plans/ })).toContainText('1 active');
  await expect(app.getByRole('button', { name: /Mutual funds/ })).toContainText('2 held');

  await app.getByRole('button', { name: /Mutual funds/ }).click();
  for (const fund of ['Test Money Market Fund', 'Test Equity Fund', 'Sample Income Fund']) await expect(app.getByText(fund).first()).toBeVisible();

  await app.getByRole('button', { name: /Gold and Silver/ }).click();
  for (const name of ['Wedding gold', '24k bar', 'Silver coins']) await expect(app.getByText(name).first()).toBeVisible();

  await app.getByRole('button', { name: /Savings plans/ }).click();
  await expect(app.getByText('Mahana Bachat').first()).toBeVisible();
  expect(await pageText(app)).toContain('Old savings plan');
});

test('Empty portfolio is locked and shows an empty state', async ({ app }) => {
  await choosePortfolio(app, 'Empty · locked');
  await expect(app.getByText('Start your portfolio')).toBeVisible();
  await expect(app.getByText(/This portfolio is locked/)).toBeVisible();
});

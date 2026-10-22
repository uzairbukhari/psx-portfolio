import { expect, test } from './fixtures';

// Future you is its own page: the plan's projection plus what-ifs compared against it, and a goal panel.
test('future you: stop-after-3-years what-if against the plan, then a goal', async ({ app }) => {
  await app.goto('/future');
  await expect(app.getByRole('heading', { name: 'Future you' }).first()).toBeVisible({ timeout: 60_000 });
  await app.getByRole('button', { name: 'Stop after 3 years' }).click();
  await expect(app.getByText(/Stopping after 3 years still grows to/)).toBeVisible();
  await expect(app.getByRole('columnheader', { name: /Your plan/ })).toBeVisible();
  // The raise chip always differs from the plan's own yearly raise (10% in the seed, so 15%).
  await app.getByRole('button', { name: /^Raise \d+% a year$/ }).click();
  await expect(app.getByRole('columnheader', { name: /Raise \d+% a year/ })).toBeVisible();
  // At most two what-ifs: the rest of the chips are off until one is removed.
  await expect(app.getByRole('button', { name: 'Start 2 years later' })).toBeDisabled();
  await app.getByRole('button', { name: /^Remove Raise \d+% a year$/ }).click();

  await app.getByRole('button', { name: 'Reach a goal' }).click();
  await expect(app.getByText(/On your plan you reach/)).toBeVisible();
  await app.getByLabel('Goal year (optional)').fill('2040');
  await expect(app.getByText(/short|in time for/)).toBeVisible();
  await app.screenshot({ path: process.env.FUTURE_SHOT ?? 'test-results/future.png', fullPage: true });
});

test('future you: the builder turns changes on and compares them', async ({ app }) => {
  await app.goto('/future');
  await app.getByRole('button', { name: 'Build your own' }).click();
  await app.getByLabel(/Raise it every year/).check();
  await app.getByLabel(/Skip some months each year/).check();
  await app.getByRole('button', { name: 'Compare' }).click();
  await expect(app.getByText(/Raise \d+% a year \+ Skip 2 months a year/).first()).toBeVisible();
});

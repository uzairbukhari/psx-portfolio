import { expect, test } from './fixtures';

// Charts are canvas (ECharts, loaded when a chart scrolls into view); each is a role=img with a label.
const charts = (app: import('@playwright/test').Page) => app.locator('[role=img][aria-label]:has(canvas)');

test('reports render interactive canvas charts', async ({ app }) => {
  await app.goto('/reports');
  await expect(app.getByText(/net worth/i).first()).toBeVisible({ timeout: 60_000 });
  // The canvas charts live in the Advanced view; Guided uses plain cards.
  await app.getByRole('button', { name: 'Advanced', exact: true }).click();
  // Lazy charts mount as they scroll into view.
  for (let i = 0; i < 12; i++) {
    await app.mouse.wheel(0, 900);
    await app.waitForTimeout(250);
  }
  await expect.poll(async () => charts(app).count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  await expect(app.getByText(/something went wrong|application error/i)).toHaveCount(0);

  const first = charts(app).first();
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  expect(box).toBeTruthy();
  await expect(first.locator('canvas').first()).toBeVisible();
  // Hovering must not break the chart or the page.
  await app.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await app.mouse.move(box!.x + box!.width / 2 + 6, box!.y + box!.height / 2 + 2);
  await expect(first.locator('canvas').first()).toBeVisible();
  await expect(app.getByText(/something went wrong|application error/i)).toHaveCount(0);
});

test('Guided insights open on plain-English cards with an Advanced switch', async ({ app }) => {
  await app.goto('/insights');
  await expect(app.getByText(/net worth/i).first()).toBeVisible({ timeout: 60_000 });
  // The page is shared across specs and the mode is remembered per device; the test above left it on Advanced.
  await app.getByRole('button', { name: 'Guided', exact: true }).click();
  await expect(app.getByText('Investing habit')).toBeVisible();
  await expect(app.getByText('Where your money is')).toBeVisible();
  await expect(app.getByText('How you compare')).toBeVisible();
  await expect(app.getByText('Growth', { exact: true }).first()).toBeVisible();
  await app.getByRole('button', { name: 'Advanced', exact: true }).click();
  await expect(app.getByText('Investing habit')).toHaveCount(0);
  await app.getByRole('button', { name: 'Guided', exact: true }).click();
  await expect(app.getByText('Investing habit')).toBeVisible();
});

test('Advanced insights are one short summary, not every asset class stacked', async ({ app }) => {
  await app.goto('/insights');
  await expect(app.getByText(/net worth/i).first()).toBeVisible({ timeout: 60_000 });
  await app.getByRole('button', { name: 'Advanced', exact: true }).click();
  for (let i = 0; i < 12; i++) {
    await app.mouse.wheel(0, 900);
    await app.waitForTimeout(250);
  }
  await expect(app.getByText('Where your money is')).toBeVisible();
  const n = await charts(app).count();
  expect(n).toBeGreaterThanOrEqual(4);
  expect(n).toBeLessThanOrEqual(8);
  // Opening one class shows that class only.
  await app.getByRole('button', { name: 'Stocks', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await expect(app.getByText('Where your money is')).toHaveCount(0);
});

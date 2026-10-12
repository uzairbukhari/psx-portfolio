import { expect, isLocal, pageText, test } from './fixtures';

test('activity timeline: filters, voided entries and expected dividends', async ({ app }) => {
  await app.goto('/activity');
  await expect(app.getByText(/Every buy, sale, dividend and split/)).toBeVisible({ timeout: 60_000 });
  for (const filter of ['Buys', 'Sells', 'Dividends', 'Splits', 'Other assets']) await expect(app.getByRole('button', { name: filter }).first()).toBeVisible();
  await expect(app.getByLabel(/Voided \(\d+\)/)).toBeVisible();
  // Seeded: OGDC and MEBL. The matching public OGDC announcement must not add a duplicate (local fixtures only).
  if (isLocal) await expect(app.getByText('Expected dividend')).toHaveCount(2);
  expect(await pageText(app)).toContain('Expected dividend');
});

test('notifications history: read, unread and cleared', async ({ app }) => {
  await app.goto('/notifications');
  await expect(app.getByText(/Everything from your portfolio/)).toBeVisible({ timeout: 60_000 });
  const text = await pageText(app);
  // Seeded: 4 notifications (2 unread, 1 cleared). Staging may add real announcements on top, so exact counts are local only.
  if (isLocal) {
    expect(text).toMatch(/All 4/);
    expect(text).toMatch(/Unread 2/);
  }
  expect(text).toMatch(/Cleared 1/);
});

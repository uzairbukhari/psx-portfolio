import { expect, test } from './fixtures';

// Each Analytics lens loads, survives the filters and never shows an error card. Works on an empty sandbox: panels
// show their empty states then.
const LENSES = [
  ['/admin/pulse', 'Summary', 'Active people'],
  ['/admin/journeys', 'Journeys', 'Funnel'],
  ['/admin/engagement', 'Engagement', 'Retention cohorts'],
  ['/admin/acquisition', 'Acquisition', 'Sign-ups by source'],
  ['/admin/quality', 'Quality', 'Page speed'],
] as const;

for (const [path, title, panel] of LENSES) {
  test(`admin analytics ${title} loads and filters`, async ({ app }) => {
    await app.goto(path);
    await expect(app.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 60_000 });
    await expect(app.getByRole('heading', { level: 2, name: panel }).first()).toBeVisible({ timeout: 30_000 });
    await app.getByRole('switch', { name: 'Include internal accounts' }).click();
    await app.getByRole('group', { name: 'Platform' }).getByRole('button', { name: 'Web' }).click();
    await expect(app).toHaveURL(/platform=web/);
    await expect(app.getByRole('heading', { level: 2, name: panel }).first()).toBeVisible();
    await expect(app.getByText('The report did not load.')).toHaveCount(0);
    await expect(app.getByText(/something went wrong|application error/i)).toHaveCount(0);
  });
}

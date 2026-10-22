import { expect, test } from './fixtures';

// The seeded account is not new, so nothing starts on its own: the Help panel and the replayable tour are what a
// returning person can reach. (The first-run start screen and checklist are covered by tests/onboarding.test.mjs.)
test('help panel: answers, and the tour replays from it with the keyboard', async ({ app }) => {
  await app.locator('.side-user .account-trigger').click();
  await app.getByRole('menuitem', { name: 'Help and tour' }).click();
  const help = app.getByRole('dialog', { name: 'Help' });
  await expect(help.getByText('How Sipwise works')).toBeVisible();
  await help.getByRole('button', { name: /What is the vault password/ }).click();
  await expect(help.getByText(/Nobody else can read it/)).toBeVisible();

  await help.getByRole('button', { name: /Take the tour/ }).click();
  const step = app.getByRole('dialog', { name: /Your money, today/ });
  await expect(step).toBeVisible({ timeout: 10_000 });
  await expect(step.getByText(/Step 1 of/)).toBeVisible();
  await app.keyboard.press('ArrowRight');
  await expect(app.getByRole('dialog', { name: /Add anything, any time/ })).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(app.locator('.tour-pop')).toHaveCount(0);
});

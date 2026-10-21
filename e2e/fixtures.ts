import { expect, test as base, type Page } from '@playwright/test';
import { loadEnvFile, resolveTarget } from '../scripts/test-env.mjs';
import { TEST_ACCOUNT_EMAIL, TEST_VAULT_PASSWORD } from '../lib/test-account.ts';

loadEnvFile();
export const isStaging = process.env.E2E_TARGET === 'staging';
const base_url = () => resolveTarget(isStaging ? 'staging' : 'local').url;

/** Signs in as the test account (staging only; the local sandbox is always signed in) and unlocks the vault. */
export async function unlock(page: Page) {
  if (isStaging) {
    const res = await page.context().request.post('/api/auth/test-login', {
      data: { secret: process.env.TEST_LOGIN_SECRET ?? '' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.ok(), 'staging test login (needs TEST_LOGIN_SECRET)').toBeTruthy();
  }
  await page.goto('/');
  const password = page.getByLabel('Vault password');
  await expect(password.or(page.getByRole('navigation', { name: 'Main' }).first())).toBeVisible({ timeout: 60_000 });
  if (await password.isVisible()) {
    await password.fill(TEST_VAULT_PASSWORD);
    // Reloads inside this tab then stay unlocked (sessionStorage), so specs can navigate by URL.
    await page.getByLabel(/Keep me unlocked in this tab/).check();
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible({ timeout: 60_000 });
}

type Worker = { shared: Page };
// The vault is unlocked once per run (key derivation takes seconds) and the same page is reused by every spec,
// which starts each test from the app root. A failing test gets a screenshot attached.
export const test = base.extend<{ app: Page }, Worker>({
  shared: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({ baseURL: base_url(), viewport: { width: 1360, height: 900 } });
      const page = await context.newPage();
      await unlock(page);
      await provide(page);
      await context.close();
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  app: async ({ shared }, provide, testInfo) => {
    await shared.goto('/');
    await expect(shared.getByRole('navigation', { name: 'Main' }).first()).toBeVisible({ timeout: 60_000 });
    await provide(shared);
    if (testInfo.status !== testInfo.expectedStatus)
      await testInfo.attach('screenshot', { body: await shared.screenshot({ fullPage: true }), contentType: 'image/png' });
  },
});
export { expect, TEST_ACCOUNT_EMAIL };

export const isLocal = !isStaging;

/** Picks a portfolio in the header switcher and waits for the app to finish reloading it. */
export async function choosePortfolio(page: Page, name: string) {
  await page.getByRole('button', { name: 'Select portfolio' }).click();
  await page.getByRole('menuitem', { name, exact: false }).first().click();
  // A portfolio with no records shows the "Start your portfolio" screen (beside the tabs when other portfolios exist).
  await expect(page.getByRole('navigation', { name: 'Main' }).or(page.getByText('Start your portfolio')).first()).toBeVisible({ timeout: 30_000 });
}

/** The visible page text on one line, for loose "this content is on the page" assertions. */
export const pageText = async (page: Page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

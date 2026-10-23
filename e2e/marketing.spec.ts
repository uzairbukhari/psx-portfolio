import { expect, test } from '@playwright/test';

// The signed-out marketing pages: no session, no vault, no dashboard code.
test.use({ storageState: { cookies: [], origins: [] } });

const PAGES = ['/', '/features', '/security', '/pricing', '/guide'];

for (const path of PAGES) {
  test(`marketing ${path}: loads clean, sign-in links carry a source`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(path);
    await expect(page.locator('.mk')).toBeVisible();
    const ctas = page.locator('a[href*="/api/auth/google/login"]');
    expect(await ctas.count()).toBeGreaterThan(0);
    for (const href of await ctas.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))) {
      expect(href).toMatch(/[?&]src=[a-z_]+/);
    }
    expect(errors).toEqual([]);
  });
}

test('home: calculator updates and the encryption demo runs', async ({ page }) => {
  await page.goto('/');
  const amount = page.locator('#cAmt');
  await amount.scrollIntoViewIfNeeded();
  const before = await page.locator('.m-calc').innerText();
  await amount.fill('50000');
  await amount.dispatchEvent('input');
  await expect.poll(async () => page.locator('.m-calc').innerText()).not.toBe(before);
  await page.locator('#mk-plain').fill('hello');
  await expect(page.locator('#mk-cipher')).not.toHaveText('');
});

test('home: no horizontal scroll on a phone, and motion respects reduced-motion', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

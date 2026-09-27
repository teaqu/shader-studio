import { expect, test } from '@playwright/test';

test('installs the cached standalone shell and reloads it offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null));
    } catch {
      // An already-running preview may activate a freshly built worker and
      // perform its single safe reload while this poll is in flight.
      return false;
    }
  })
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await context.setOffline(false);
});

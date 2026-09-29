import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

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

test('keeps offline compiler readiness after a refresh', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith('shader-studio-')).map((name) => caches.delete(name)));
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller !== null)))
    .toBe(true);

  await page.getByRole('button', { name: 'Workspace' }).click();
  await page.getByRole('button', { name: 'Download compilers for offline use' }).click();
  const buildStatus = page.getByRole('status');
  await expect(buildStatus).toHaveAttribute('aria-label', /Ready offline/);

  await page.reload();
  await expect(buildStatus).toHaveAttribute('aria-label', /Ready offline/);
  await page.getByRole('button', { name: 'Workspace' }).click();
  await expect(page.getByRole('button', { name: 'Download compilers for offline use' })).toHaveCount(0);
});

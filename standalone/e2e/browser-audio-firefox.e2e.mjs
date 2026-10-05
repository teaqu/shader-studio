import { test, expect } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

test('Firefox loads Audio assets and explains unsupported Shared Audio', async ({ page }) => {
  await page.addInitScript(() => {
    window.__screenSharingRequests = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.__screenSharingRequests++;
      throw new Error('Firefox must not open a screen-only picker for audio');
    };
  });
  await page.route('**/__live_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__live_fixture__');
  await workspace(page, [
    ['firefox-audio.glsl', 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0,1,0,1); }'],
    ['firefox-audio.sha.json', JSON.stringify({ version: '1', passes: { Image: { inputs: { sound: { type: 'system-audio' } } } } })],
  ]);
  await page.goto('/');
  await page.getByTestId('shader-option-firefox-audio-glsl').click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await page.locator('.channel-row').filter({ hasText: 'sound' }).click();
  await expect(page.getByRole('tab', { name: 'Audio', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Start sharing', exact: true })).toBeDisabled({ timeout: 3000 });
  await expect(page.getByText('Loading files...', { exact: true })).toHaveCount(0, { timeout: 1000 });
  await expect(page.getByText('No files found', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole('button', { name: 'Start sharing', exact: true }).evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(28);
  await expect(page.getByRole('heading', { name: 'Audio file', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Path to audio or video file')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Firefox does not support' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Firefox does not support' })).toHaveCSS('border-left-style', 'solid');
  expect(await page.evaluate(() => window.__screenSharingRequests)).toBe(0);
  await page.reload();
  await page.locator('.channel-row').filter({ hasText: 'sound' }).click();
  await expect(page.getByRole('button', { name: 'Start sharing', exact: true })).toBeDisabled();
  await expect(page.getByText('No files found', { exact: true })).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Firefox does not support' })).toHaveCSS('border-left-style', 'solid');
  expect(await page.evaluate(() => window.__screenSharingRequests)).toBe(0);
});

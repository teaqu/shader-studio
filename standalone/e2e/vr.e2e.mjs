import { expect, test } from '@playwright/test';
import { addShaderFiles } from './workspace-store.mjs';

const shader = `
void mainImage(out vec4 c, in vec2 p) { c = vec4(1, 0, 0, 1); }
void mainVR(out vec4 c, in vec2 p, in vec3 o, in vec3 d) { c = vec4(d * 0.5 + 0.5, 1); }`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.route('**/__vr_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>VR fixture</title>' }));
  await page.goto('/__vr_fixture__');
  await addShaderFiles(page, [['vr-pane.glsl', shader]]);
  await page.goto('/');
  await expect(page.getByTestId('shader-option-vr-pane-glsl')).toHaveAttribute('aria-pressed', 'true');
});

test('VR uses a docked tool pane and preserves navigation settings after reload', async ({ page }) => {
  const button = page.getByRole('button', { name: 'VR', exact: true });
  await expect(button).toBeVisible();
  await expect(page.locator('.right-group > button').first()).toHaveAttribute('aria-label', 'VR');
  await expect(page.getByRole('region', { name: 'VR settings' })).toHaveCount(0);
  await button.click();
  const panel = page.getByRole('region', { name: 'VR settings' });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Left stick movement')).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'VR documentation' })).toHaveAttribute('href', /#optional-shader-studio-controller-inputs$/);
  await expect(page.locator('.dv-tab').filter({ hasText: /^VR$/ })).toHaveCount(1);
  await expect(panel.getByLabel('Enable headset navigation')).not.toBeChecked();
  await expect(panel.getByLabel('Right stick turning')).toHaveValue('off');
  await panel.getByLabel('Enable headset navigation').check();
  await panel.getByLabel('Right stick turning').selectOption('snap');
  await panel.getByLabel('Snap angle (degrees)').fill('45');
  await panel.getByLabel('Snap angle (degrees)').press('Tab');
  await page.reload();
  await expect(page.getByTestId('shader-option-vr-pane-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Enable headset navigation')).toBeChecked();
  await expect(panel.getByLabel('Right stick turning')).toHaveValue('snap');
  await expect(panel.getByLabel('Snap angle (degrees)')).toHaveValue('45');
  await panel.getByLabel('Enable headset navigation').uncheck();
  await page.reload();
  await expect(panel.getByLabel('Enable headset navigation')).not.toBeChecked();
  await expect(panel.getByLabel('Right stick turning')).toHaveValue('snap');
  await expect(panel.getByLabel('Right stick turning')).toBeDisabled();
  await panel.getByLabel('Enable headset navigation').check();
  await expect(panel.getByLabel('Snap angle (degrees)')).toHaveValue('45');
  await panel.getByRole('button', { name: 'Close VR settings' }).click();
  await expect(panel).toHaveCount(0);
  await button.click();
  await expect(panel).toBeVisible();
});

test('VR is the last tool to collapse and remains accessible through the menu', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'VR', exact: true })).toBeVisible();
  const preview = page.getByTestId('web-preview');
  const sash = page.locator('.standalone-dockview .dv-sash.dv-enabled:not(.standalone-panel-source *)').last();
  // Resize the real editor/preview split, keeping the desktop workspace active.
  const bounds = await preview.boundingBox();
  const split = await sash.boundingBox();
  expect(bounds).not.toBeNull();
  expect(split).not.toBeNull();
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 320, split.y + split.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'VR', exact: true })).toBeVisible();
  await expect(page.locator('.right-group .collapse-config')).not.toBeVisible();
  const narrowed = await preview.boundingBox();
  const nextSplit = await sash.boundingBox();
  await page.mouse.move(nextSplit.x + nextSplit.width / 2, nextSplit.y + nextSplit.height / 2);
  await page.mouse.down();
  await page.mouse.move(narrowed.x + narrowed.width - 240, narrowed.y + narrowed.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.right-group button[aria-label="VR"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open options menu' }).click();
  await page.getByRole('button', { name: 'VR', exact: true }).click();
  await expect(page.getByRole('region', { name: 'VR settings' })).toBeVisible();
});

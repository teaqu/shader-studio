import { expect, test } from '@playwright/test';

test('phone shell preserves the selected shader across Explorer, Preview, Editor, and Tools', async ({ page }) => {
  await page.goto('/');
  const workspaceNav = page.getByRole('navigation', { name: 'Workspace panels' });
  await expect(workspaceNav).toBeVisible();
  await expect(workspaceNav.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-current', 'page');

  await workspaceNav.getByRole('button', { name: 'Explorer' }).click();
  const explorer = page.getByTestId('web-shader-explorer');
  await expect(explorer).toBeInViewport();
  // Selecting a shader immediately changes the active phone panel, so dispatch
  // the complete click without waiting for the selected card to remain mounted.
  await explorer.getByTestId('shader-option-aurora-glsl').dispatchEvent('click');

  await workspaceNav.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('web-preview')).toBeInViewport();
  await expect(explorer.getByTestId('shader-option-aurora-glsl')).toHaveAttribute('aria-pressed', 'true');

  await workspaceNav.getByRole('button', { name: 'Editor' }).click();
  await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeInViewport();

  await workspaceNav.getByRole('button', { name: 'Tools' }).click();
  const tools = page.getByRole('navigation', { name: 'Tools' });
  await expect(tools).toBeVisible();
  for (const name of ['Config', 'Debug', 'Frame Times', 'Export']) {
    await tools.getByRole('button', { name }).click();
    await expect(tools.getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
  }

  await page.setViewportSize({ width: 780, height: 390 });
  await expect(workspaceNav).toBeHidden();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(workspaceNav).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('touch input survives cancellation and remains usable after orientation changes', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await nav.getByRole('button', { name: 'Preview' }).click();
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  await canvas.dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: box.x + 20, clientY: box.y + 20 });
  await canvas.dispatchEvent('pointercancel', { pointerId: 3, pointerType: 'touch' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
});

test('small desktop windows keep mobile navigation in a bottom row', async ({ page }) => {
  await page.setViewportSize({ width: 724, height: 900 });
  await page.goto('/');

  const navigation = page.getByRole('navigation', { name: 'Workspace panels' });
  await expect(navigation).toBeVisible();
  const box = await navigation.boundingBox();

  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(700);
  expect(box.height).toBeLessThan(80);
});

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
  const toolPanels = [
    ['Config', '.config-panel'],
    ['Debug', '.debug-panel'],
    ['Frame Times', '.performance-panel'],
    ['Export', '.recording-panel'],
  ];
  for (const [name, panel] of toolPanels) {
    await tools.getByRole('button', { name }).click();
    await expect(tools.getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(panel)).toBeVisible();
  }
  await expect(page.locator('.standalone-dockview .dv-tabs-and-actions-container:visible')).toHaveCount(0);

  await page.setViewportSize({ width: 780, height: 390 });
  await expect(workspaceNav).toBeHidden();
  await expect(page.locator('.recording-panel')).toBeVisible();
  await expect(page.locator('.standalone-dockview .dv-tabs-and-actions-container:visible')).not.toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(workspaceNav).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('touch input survives cancellation and remains usable after orientation changes', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  // Selection navigates away from Explorer immediately, detaching the card
  // before Playwright's multi-step pointer action can finish.
  await page.getByTestId('shader-option-aurora-glsl').dispatchEvent('click');
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

test('mobile Export tabs stay inside their bar and video recording downloads', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  const workspaceNav = page.getByRole('navigation', { name: 'Workspace panels' });
  await workspaceNav.getByRole('button', { name: 'Tools' }).click();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Export' }).click();

  const tabBar = page.locator('.recording-panel > .tab-navigation');
  const tabBarBox = await tabBar.boundingBox();
  const tabBoxes = await tabBar.locator('.tab-button').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
  }));
  expect(tabBarBox).not.toBeNull();
  for (const box of tabBoxes) {
    expect(box.top).toBeGreaterThanOrEqual(tabBarBox.y);
    expect(box.left).toBeGreaterThanOrEqual(tabBarBox.x);
    expect(box.right).toBeLessThanOrEqual(tabBarBox.x + tabBarBox.width);
    expect(box.bottom).toBeLessThanOrEqual(tabBarBox.y + tabBarBox.height);
  }

  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByRole('button', { name: 'WebM', exact: true }).click();
  await page.locator('input[min="0.5"][step="0.5"]').fill('0.5');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^shader-.*\.webm$/);
  expect(await download.failure()).toBeNull();
  expect(pageErrors).toEqual([]);
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
  await expect(page.locator('.menu-bar .collapse-config')).toBeHidden();
  await expect(page.locator('.menu-bar .collapse-debug')).toBeHidden();
  await expect(page.locator('.menu-bar .collapse-record')).toBeHidden();

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator('.menu-bar .collapse-config')).toBeVisible();
  await expect(page.locator('.menu-bar .collapse-debug')).toBeVisible();
  await expect(page.locator('.menu-bar .collapse-record')).toBeVisible();
});

test('a finger tap pins the pixel inspector, a second tap moves it, and tapping the pin clears it', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await page.getByTestId('shader-option-aurora-glsl').dispatchEvent('click');
  await nav.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('web-preview');
  const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(canvas).toBeVisible();
  // Narrow menu bars move the debug toggle into the options menu.
  await preview.getByLabel('Open options menu', { exact: true }).click();
  await page.getByLabel('Toggle debug mode', { exact: true }).locator('visible=true').click();

  const fragCoordAt = (fx, fy) => canvas.evaluate((element, [fx, fy]) => {
    const rect = element.getBoundingClientRect();
    const x = Math.floor(fx * element.width);
    const y = Math.floor(fy * element.height);
    return { client: { x: rect.left + (x + 0.5) * rect.width / element.width, y: rect.top + (y + 0.5) * rect.height / element.height }, text: `${x.toFixed(1)}, ${(element.height - y).toFixed(1)}` };
  }, [fx, fy]);
  const inspectorShows = async (text) => {
    await nav.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Debug' }).click();
    const section = page.locator('.pixel-inspector-section');
    if (text === null) {
      await expect(section.locator('canvas')).toHaveClass(/empty/);
      await expect(section.locator('canvas')).not.toHaveClass(/locked/);
    } else {
      await expect(section.locator('canvas')).toHaveClass(/locked/);
      await expect(section.locator('.info-label:text-is("fragCoord") + .info-val')).toHaveText(text);
    }
    await nav.getByRole('button', { name: 'Preview' }).click();
    await expect(canvas).toBeVisible();
  };

  const first = await fragCoordAt(0.25, 0.25);
  await page.touchscreen.tap(first.client.x, first.client.y);
  await inspectorShows(first.text);

  const second = await fragCoordAt(0.75, 0.6);
  await page.touchscreen.tap(second.client.x, second.client.y);
  await inspectorShows(second.text);

  await page.touchscreen.tap(second.client.x, second.client.y);
  await inspectorShows(null);
});

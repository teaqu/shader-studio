import { expect, test } from '@playwright/test';
import { readWorkspaceFiles } from './workspace-store.mjs';

test('new shader opens blank and focused, validates its name, and saves the named shader', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await page.getByTestId('web-shader-explorer').getByTitle('New Shader').click();
  const dialog = page.getByRole('dialog', { name: 'New Shader' });
  const name = dialog.getByLabel('Shader name');
  await expect(name).toHaveValue('');
  await expect(name).toBeFocused();
  for (const value of ['', '   ']) {
    await name.fill(value);
    await dialog.getByRole('button', { name: 'Create Shader' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a shader name.');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
  }
  await name.fill('mobile-named');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await name.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await readWorkspaceFiles(page)).some(file => file.path === '/shaders/mobile-named.glsl')).toBe(true);
  await page.reload();
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await expect(page.getByTestId('web-shader-explorer').getByTestId('shader-option-mobile-named-glsl')).toBeVisible();
});

test('vertex visibility is default-on and the chosen option survives reload', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  const explorer = page.getByTestId('web-shader-explorer');
  await explorer.getByTitle('New Shader').click();
  const dialog = page.getByRole('dialog', { name: 'New Shader' });
  await dialog.getByLabel('Shader name').fill('mesh.vert');
  await dialog.getByRole('button', { name: 'Create Shader' }).click();
  await expect(dialog).toBeHidden();
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await explorer.getByTitle('Options').click();
  const hideVertex = explorer.getByLabel('Hide Vertex');
  await expect(hideVertex).toBeChecked();
  await expect(explorer.getByTestId('shader-option-mesh-vert-glsl')).toHaveCount(0);
  await hideVertex.uncheck();
  await expect(explorer.getByTestId('shader-option-mesh-vert-glsl')).toBeVisible();
  await expect.poll(async () => {
    const files = await readWorkspaceFiles(page);
    const state = files.find(file => file.path === '/.shader-studio/explorer-state.json');
    return state && JSON.parse(state.contents).hideVertexShaders;
  }).toBe(false);
  await page.reload();
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await expect(explorer.getByTestId('shader-option-mesh-vert-glsl')).toBeVisible();
  await expect(hideVertex).not.toBeChecked();
  await hideVertex.check();
  await expect(explorer.getByTestId('shader-option-mesh-vert-glsl')).toHaveCount(0);
});

test('word wrap shortcuts share the preference and persist across reload', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  const wrap = page.getByTestId('web-editor').getByRole('button', { name: 'Wrap text' });
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await nav.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Open options menu' }).click();
  await page.getByRole('button', { name: 'Open editor submenu' }).click();
  const overlayWrap = page.locator('.editor-submenu-portal').getByRole('button', { name: 'Wrap text' });
  await expect(overlayWrap).toHaveAttribute('aria-pressed', 'true');
  await overlayWrap.click();
  await expect(overlayWrap).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();
  await page.reload();
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
});

test('storage protection is requested automatically and the Workspace menu explains a declined request', async ({ page }) => {
  await page.addInitScript(() => {
    let protectedStorage = false;
    window.__storageProtectionRequests = Number(sessionStorage.getItem('test-storage-requests') ?? 0);
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => protectedStorage });
    Object.defineProperty(navigator.storage, 'persist', { value: async () => {
      window.__storageProtectionRequests++;
      sessionStorage.setItem('test-storage-requests', String(window.__storageProtectionRequests));
      protectedStorage = window.__storageProtectionRequests > 1;
      return protectedStorage;
    } });
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__storageProtectionRequests)).toBe(1);
  const warning = page.getByRole('button', { name: 'Storage warning' });
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('title', /space runs low/);
  await expect(page.locator('.build-status').getByRole('button', { name: 'Storage warning' })).toBeVisible();
  await expect(page.getByTestId('storage-warning')).toHaveCount(0);
  const warningBox = await warning.boundingBox();
  expect(warningBox.x + warningBox.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.reload();
  await warning.click();
  const menu = page.getByRole('menu', { name: 'Workspace' });
  await expect(menu).toContainText('Work saves automatically.');
  await expect(menu).toContainText('The browser may remove local work if space runs low.');
  await expect(page.getByTestId('storage-warning')).toHaveCount(0);
  expect(await page.evaluate(() => window.__storageProtectionRequests)).toBe(1);
  await menu.getByRole('button', { name: 'Request storage protection' }).click();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(menu).toContainText('Storage protection is enabled.');
  await expect(warning).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Request storage protection' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__storageProtectionRequests)).toBe(2);
  const box = await menu.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
});

for (const [explorerWidth, previewWidth] of [[180, 280], [350, 700]]) {
test(`preview and explorer keep user widths ${explorerWidth}/${previewWidth} while the editor absorbs window resizing`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  const preview = page.getByTestId('web-preview');
  const editor = page.getByTestId('web-editor');
  await expect(explorer).toBeVisible();
  const dragEdge = async (panel, edge, targetWidth) => {
    const box = await panel.boundingBox();
    const x = edge === 'right' ? box.x + box.width : box.x;
    const change = edge === 'right' ? targetWidth - box.width : box.width - targetWidth;
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x + change, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
  };
  await dragEdge(explorer, 'right', explorerWidth);
  await expect.poll(async () => Math.abs((await explorer.boundingBox()).width - explorerWidth)).toBeLessThan(4);
  await dragEdge(preview, 'left', previewWidth);
  await expect.poll(async () => Math.abs((await preview.boundingBox()).width - previewWidth)).toBeLessThan(4);
  const wanted = { explorer: (await explorer.boundingBox()).width, preview: (await preview.boundingBox()).width };
  const expectWidths = async () => {
    await expect.poll(async () => Math.abs((await explorer.boundingBox()).width - wanted.explorer)).toBeLessThan(4);
    await expect.poll(async () => Math.abs((await preview.boundingBox()).width - wanted.preview)).toBeLessThan(4);
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.setViewportSize({ width: 800, height: 700 });
      if (explorerWidth + previewWidth < 692) {
        await expectWidths();
        await expect.poll(async () => Math.abs((await editor.boundingBox()).width - (800 - wanted.explorer - wanted.preview))).toBeLessThan(4);
      } else {
        await expect.poll(async () => (await preview.boundingBox()).width).toBeLessThan(wanted.preview);
        await expect.poll(async () => (await editor.boundingBox()).width).toBeLessThan(150);
    }
    const narrowEditorWidth = (await editor.boundingBox()).width;
    await page.setViewportSize({ width: 2200, height: 900 });
    await expectWidths();
      await expect.poll(async () => (await editor.boundingBox()).width).toBeGreaterThan(narrowEditorWidth + 900);
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(page.getByRole('navigation', { name: 'Workspace panels' })).toBeVisible();
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.getByRole('navigation', { name: 'Workspace panels' })).toBeHidden();
    await expectWidths();
  }
  await page.reload();
  await expectWidths();
});
}
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
  // Read the container and its children in one layout snapshot: opening Tools
  // can move the panel between separate Playwright calls.
  const { tabBarBox, tabBoxes } = await tabBar.evaluate((bar) => {
    const container = bar.getBoundingClientRect();
    return {
      tabBarBox: { x: container.x, y: container.y, width: container.width, height: container.height },
      tabBoxes: [...bar.querySelectorAll('.tab-button')].map((button) => {
        const box = button.getBoundingClientRect();
        return { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
      }),
    };
  });
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

  // Touch points are whole CSS pixels, so derive the expected canvas pixel
  // from the rounded point with the inspector's own mapping.
  // Returning to Preview re-lays the canvas out, so wait for it to stop moving
  // before choosing a point; a stale rectangle picks the wrong pixel.
  const settled = async () => {
    let previous = null;
    await expect.poll(async () => {
      const box = JSON.stringify(await canvas.boundingBox());
      const still = box === previous;
      previous = box;
      return still;
    }, { intervals: [100] }).toBe(true);
  };
  const fragCoordAt = async (fx, fy) => (await settled(), canvas.evaluate((element, [fx, fy]) => {
    const rect = element.getBoundingClientRect();
    const client = { x: Math.round(rect.left + fx * rect.width), y: Math.round(rect.top + fy * rect.height) };
    const x = Math.floor(((client.x - rect.left) / rect.width) * element.width);
    const y = Math.floor(((client.y - rect.top) / rect.height) * element.height);
    return { client, text: `${x.toFixed(1)}, ${(element.height - y).toFixed(1)}` };
  }, [fx, fy]));
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

// Monaco picks shortcuts from the emulated Android user agent, so phone tests
// press Control even on a macOS host, where ControlOrMeta would send Meta.
async function openAuroraOnPhone(page) {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  // Selection moves the phone to the Editor at once, detaching the card.
  await page.getByTestId('shader-option-aurora-glsl').dispatchEvent('click');
  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  return nav;
}

async function persisted(page, marker) {
  await expect.poll(async () => (await readWorkspaceFiles(page))
    .some((file) => file.path.endsWith('/aurora.glsl') && file.contents.includes(marker))).toBe(true);
}

test('the phone Editor and the preview overlay edit one document with shared undo, and the edit survives reload', async ({ page }) => {
  const nav = await openAuroraOnPhone(page);
  const editor = page.getByTestId('web-editor');
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await editor.locator('.inputarea').press('Control+A');
  await page.keyboard.insertText('void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.5); } // phone edit');
  await expect(editor.locator('.view-lines')).toContainText('phone edit');
  // Proves select-all replaced the shader rather than inserting into it.
  await expect(editor.locator('.view-lines')).not.toContainText('iResolution');

  await nav.getByRole('button', { name: 'Preview' }).click();
  await page.getByLabel('Open options menu', { exact: true }).click();
  await page.getByLabel('Open editor submenu').locator('visible=true').click();
  await page.getByLabel('Enable editor overlay').locator('visible=true').click();
  const overlay = page.locator('.editor-wrapper:not(.pane)');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.view-lines')).toContainText('phone edit');
  await page.getByLabel('Open options menu', { exact: true }).click();
  await expect(page.getByLabel('Open editor submenu').locator('visible=true')).toHaveCount(0);

  // Undo from the overlay reverts the edit made in the Editor panel.
  // The long line leaves Monaco scrolled sideways, so aim at the editor itself.
  await overlay.locator('.monaco-editor').click({ position: { x: 120, y: 10 } });
  await overlay.locator('.inputarea').press('Control+Z');
  await expect(overlay.locator('.view-lines')).not.toContainText('phone edit');
  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(editor.locator('.view-lines')).not.toContainText('phone edit');

  await editor.locator('.monaco-editor').click({ position: { x: 120, y: 10 } });
  await editor.locator('.inputarea').press('Control+Shift+Z');
  await expect(editor.locator('.view-lines')).toContainText('phone edit');
  await persisted(page, 'phone edit');

  await page.reload();
  await expect(page.getByTestId('shader-option-aurora-glsl')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Editor' }).click();
  await expect(editor.locator('.view-lines')).toContainText('phone edit');
});

test('a workspace backup exported on a phone restores the work after the workspace is cleared', async ({ page }, testInfo) => {
  await openAuroraOnPhone(page);
  const editor = page.getByTestId('web-editor');
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await editor.locator('.inputarea').press('Control+A');
  await page.keyboard.insertText('void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.25); } // backed up');
  await expect(editor.locator('.view-lines')).not.toContainText('iResolution');
  await persisted(page, 'backed up');

  await page.getByRole('button', { name: 'Workspace' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Workspace Backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('shader-studio-workspace.json');
  const backupPath = testInfo.outputPath('workspace-backup.json');
  await download.saveAs(backupPath);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Workspace' }).click();
  // Clearing reloads the app; reading storage mid-reload would race it.
  const cleared = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Clear Workspace' }).click();
  await cleared;
  await expect.poll(async () => (await readWorkspaceFiles(page))
    .some((file) => file.contents.includes('backed up'))).toBe(false);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Workspace' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import Workspace Backup…' }).click();
  // A successful import reloads the app onto the restored workspace.
  const reloaded = page.waitForEvent('load');
  await (await chooserPromise).setFiles(backupPath);
  await reloaded;
  await persisted(page, 'backed up');

  await page.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Explorer' }).click();
  await page.getByTestId('shader-option-aurora-glsl').dispatchEvent('click');
  await expect(editor.locator('.view-lines')).toContainText('backed up');
});

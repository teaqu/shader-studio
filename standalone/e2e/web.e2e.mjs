import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

test('buffer shaders are hidden by default and the explorer option survives reload', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  const trails = explorer.getByTestId('shader-option-trails-buffer-glsl');
  const glow = explorer.getByTestId('shader-option-glow-buffer-glsl');
  await expect(explorer.getByTestId('shader-option-glow-trails-glsl')).toBeVisible();
  await expect(trails).toHaveCount(0);
  await expect(glow).toHaveCount(0);
  await explorer.getByTitle('Options', { exact: true }).click();
  await explorer.getByLabel('Hide Buffers', { exact: true }).uncheck();
  await expect(trails).toBeVisible();
  await expect(glow).toBeVisible();
  await page.reload();
  await expect(trails).toBeVisible();
  await expect(glow).toBeVisible();
  await expect(explorer.getByLabel('Hide Buffers', { exact: true })).not.toBeChecked();
  await explorer.getByLabel('Hide Buffers', { exact: true }).check();
  await expect(trails).toHaveCount(0);
  await expect(glow).toHaveCount(0);
});

test('standalone menu triggers use dropdown styling', async ({ page }) => {
  await page.goto('/');
  for (const name of ['View', 'Workspace']) {
    const trigger = page.getByRole('button', { name, exact: true });
    await expect(trigger).toHaveCSS('border-top-width', '0px');
    await expect(trigger.getByTestId('dropdown-indicator')).toBeVisible();
  }
});

test('highlights tab-group and split destinations while dragging in both themes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shader-option-aurora-glsl').click();
  const tab = (name) => page.locator('.dv-tab').filter({ hasText: new RegExp(`^${name}$`) });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    for (const destination of ['group', 'split']) {
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await page.getByRole('button', { name: 'Reset workspace layout', exact: true }).click();
      // Dockview positions its always-mounted content overlay on the next frame.
      await expect(page.getByTestId('web-preview')).toBeInViewport();
      const source = await tab('aurora.glsl').locator('.dv-default-tab-content').boundingBox();
      const target = await page.getByTestId('web-preview').boundingBox();
      const x = destination === 'group' ? target.x + target.width / 2 : target.x + target.width - 10;
      const y = target.y + target.height / 2;
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 10 });
      // Entering a new target fires dragenter; move within it to fire dragover.
      await page.mouse.move(x + 1, y);
      const highlight = page.locator('.dv-drop-target-anchor:visible, .dv-drop-target-selection:visible');
      await expect(highlight).toHaveCount(1);
      await expect(highlight).toHaveCSS('background-color', 'rgba(0, 127, 212, 0.25)');
      await expect(highlight).toHaveCSS('border-top-width', '2px');
      await expect(highlight).toHaveCSS('border-top-style', 'solid');
      await expect(highlight).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      const bounds = await highlight.boundingBox();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      await page.mouse.up();
      await expect(highlight).toHaveCount(0);
    }
  }
});


test('desert sky and ground stay continuous when looking around and after reload', async ({ page }) => {
  await page.goto('/');
  const shader = page.getByTestId('shader-option-desert-cubemap-glsl');
  await shader.click();
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');

  for (const reload of [false, true]) {
    if (reload) {
      await page.reload();
    }
    await expect(shader).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas).toBeVisible();
    for (const verticalPosition of [0.8, 0.2]) {
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * verticalPosition);
      await page.mouse.up();
      await expect.poll(async () => {
        const screenshot = await canvas.screenshot();
        const { width, height, data } = PNG.sync.read(screenshot);
        let maximumRowDifference = 0;
        let minimum = 255;
        let maximum = 0;
        for (let y = Math.ceil(height * 0.1); y < height * 0.9; y++) {
          const difference = [0, 0, 0];
          let samples = 0;
          for (let x = Math.ceil(width * 0.25); x < width * 0.75; x++) {
            for (let channel = 0; channel < 3; channel++) {
              const value = data[(y * width + x) * 4 + channel];
              minimum = Math.min(minimum, value);
              maximum = Math.max(maximum, value);
              difference[channel] += value - data[((y - 1) * width + x) * 4 + channel];
              samples++;
            }
          }
          // Compare row mean colours, so individual gravel pixels do not
          // count as a horizontal seam through the rendered environment.
          const rowDifference = difference.reduce((sum, value) => sum + Math.abs(value), 0) / samples;
          maximumRowDifference = Math.max(maximumRowDifference, rowDifference);
        }
        // Reject blank/loading canvases as well as a bright grid line or a
        // discontinuity between the side faces and the sky/ground.
        return maximum - minimum > 30 && maximumRowDifference < 15;
      }, { message: `continuous ${verticalPosition > 0.5 ? 'ground' : 'sky'} (reload: ${reload})` }).toBe(true);
    }
  }
});

test('runs a persistent virtual shader workspace in web mode', async ({ page }) => {
  const languageWorkerRequests = new Set();
  page.on('request', (request) => {
    const url = request.url();
    if (/\/(?:glsl|slang)LanguageService\.worker-[^/]+\.js$/.test(url)) {
      languageWorkerRequests.add(url);
    }
  });

  await page.goto('/');

  const editor = page.getByTestId('web-editor');
  const preview = page.getByTestId('web-preview');
  const explorer = page.getByTestId('web-shader-explorer');
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(explorer).toBeVisible();
  const previewTabBackground = await page.locator('.dv-tab').filter({ hasText: /^Preview$/ }).evaluate((tab) => getComputedStyle(tab).backgroundColor);
  for (const name of ['Preview', 'Shader Explorer', 'aurora.glsl']) {
    await expect(page.locator('.dv-tab').filter({ hasText: new RegExp(`^${name}$`) }))
      .toHaveCSS('background-color', previewTabBackground);
  }
  await expect.poll(() => page.evaluate(() => [
    document.querySelector('meta[name="shader-studio-slang-script-url"]')?.getAttribute('content'),
    document.querySelector('meta[name="shader-studio-slang-wasm-url"]')?.getAttribute('content'),
    document.querySelector('meta[name="shader-studio-slang-worker-url"]')?.getAttribute('content'),
  ].every(Boolean))).toBe(true);
  await expect(explorer.getByPlaceholder('Search shaders...')).toBeVisible();
  await expect.poll(async () => explorer.locator('.shader-thumbnail img').count()).toBeGreaterThanOrEqual(4);
  const thumbnailSources = await explorer.locator('.shader-thumbnail img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  expect(new Set(thumbnailSources).size).toBeGreaterThan(1);
  await expect(editor.locator('.monaco-editor')).toBeVisible();

  await page.getByLabel('Open options menu').click();
  await page.getByLabel('Open editor submenu').click();
  await page.getByLabel('Enable editor overlay').click();
  const overlayEditor = page.locator('.editor-wrapper:not(.pane)');
  await expect(overlayEditor).toBeVisible();
  await expect(editor.getByLabel('Enable Vim mode')).toHaveAttribute('aria-pressed', 'false');
  await editor.getByLabel('Enable Vim mode').click();
  await expect(editor.getByLabel('Disable Vim mode')).toHaveAttribute('aria-pressed', 'true');

  await explorer.getByTitle('New Shader').click();
  await page.getByRole('dialog', { name: 'New Shader' }).getByLabel('Shader name').fill('starter');
  await page.getByRole('button', { name: 'Create Shader', exact: true }).click();
  await editor.getByLabel('Disable Vim mode').click();
  const starterShader = page.getByTestId('shader-option-starter-glsl');
  await expect(starterShader).toBeVisible();
  await expect(starterShader.locator('.shader-error')).toHaveCount(0);
  await expect(starterShader.locator('.shader-thumbnail img')).toBeVisible();
  await expect.poll(async () => (await editor.locator('.monaco-editor').boundingBox())?.height).toBeGreaterThan(100);
  await expect.poll(() => [...languageWorkerRequests].some((url) => url.includes('/glslLanguageService.worker-'))).toBe(true);

  const editorInput = editor.locator('.inputarea');
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await editorInput.press('ControlOrMeta+A');
  await page.keyboard.insertText('void mainImage(out vec4 color, in vec2 coord) {\n  norm');
  await editorInput.press('Control+Space');
  await expect(page.locator('.suggest-widget:visible')).toBeVisible();
  await expect(page.locator('.suggest-widget:visible')).toContainText('normalize');
  const suggestionBox = await page.locator('.suggest-widget:visible').boundingBox();
  const cursorBox = await editor.locator('.cursor').first().boundingBox();
  expect(Math.abs(suggestionBox.x - cursorBox.x)).toBeLessThan(20);
  await editorInput.press('Escape');

  const editorBox = await editor.boundingBox();
  const previewBox = await preview.boundingBox();
  const explorerBox = await explorer.boundingBox();
  expect(explorerBox?.width).toBeGreaterThan(0);
  expect(explorerBox?.x).toBeLessThan(editorBox?.x ?? 0);
  expect(editorBox?.x).toBeLessThan(previewBox?.x ?? 0);

  // The last outer sash is the Editor/Preview boundary.
  const sash = page.locator('.standalone-dockview .dv-sash.dv-enabled:not(.standalone-panel-source *)').last();
  await expect(sash).toBeVisible();
  const sashBox = await sash.boundingBox();
  expect(sashBox).not.toBeNull();
  await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + sashBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sashBox.x + 120, sashBox.y + sashBox.height / 2);
  await page.mouse.up();
  await expect.poll(async () => (await editor.boundingBox())?.width).toBeGreaterThan(editorBox?.width ?? 0);

  await page.getByTestId('shader-option-aurora-slang-slang').click();
  await expect(editor.locator('.view-lines')).toContainText('aurora-slang / WebGPU');
  await expect.poll(() => [...languageWorkerRequests].some((url) => url.includes('/slangLanguageService.worker-'))).toBe(true);

  await page.getByTestId('shader-option-nebula-texture-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default texture');
  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default cubemap');
  const previewCanvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(previewCanvas).toBeVisible();
  const cubemapBeforeDrag = await previewCanvas.screenshot();
  const canvasBox = await previewCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height * 0.35);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect((await previewCanvas.screenshot()).equals(cubemapBeforeDrag)).toBe(false);
  for (const asset of [
    'assets/nebula-texture.png',
    'assets/desert-cubemap-cross.png',
  ]) {
    const response = await page.request.get(`/${asset}`);
    expect(response.ok()).toBe(true);
  }

  await page.reload();
  await expect(page.getByTestId('shader-option-desert-cubemap-glsl')).toHaveAttribute('aria-pressed', 'true');
});

test('keeps one top-level Preview alive through docking, close/reopen, reset and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shader-option-aurora-glsl').click();
  const editor = page.getByTestId('web-editor');
  const preview = page.getByTestId('web-preview');
  const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(page.locator('.dv-tab').filter({ hasText: /^Preview$/ })).toHaveCount(1);
  await expect(page.locator('.dv-tab').filter({ hasText: /^Viewer$/ })).toHaveCount(0);
  await expect(page.locator('.shader-studio-dockview-theme')).toHaveCount(0);
  await canvas.evaluate((element) => {
    window.__originalViewerCanvas = element;
  });

  await page.getByRole('button', { name: 'View', exact: true }).click();
  const previewViewItem = page.getByRole('menuitemcheckbox', { name: 'Preview', exact: true });
  await expect(previewViewItem).toHaveAttribute('aria-checked', 'true');
  await previewViewItem.click();
  await expect(preview).toBeHidden();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Preview', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('menuitemcheckbox', { name: 'Preview', exact: true }).click();
  await expect(canvas).toBeVisible();

  await preview.getByLabel('Toggle config panel').click();
  const configTab = page.locator('.dv-tab').filter({ hasText: /^Config$/ });
  await expect(configTab).toBeVisible();

  const editorTab = page.locator('.dv-tab').filter({ hasText: /\.(glsl|frag|slang)$/ });
  const viewerTab = page.locator('.dv-tab').filter({ hasText: /^Preview$/ });
  await viewerTab.locator('.dv-default-tab-action').click();
  await expect(preview).toBeHidden();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Preview', exact: true }).click();
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((element) => element === window.__originalViewerCanvas)).toBe(true);
  await expect(configTab).toBeVisible();

  await editorTab.dragTo(viewerTab);
  const outerTabOrder = () => viewerTab.evaluate((tab) =>
    [...tab.closest('.dv-tabs-container').querySelectorAll('.dv-default-tab-content')].map((label) => label.textContent),
  );
  await expect.poll(outerTabOrder).toEqual(expect.arrayContaining(['Preview', 'aurora.glsl']));
  const tabOrderBeforeClose = await outerTabOrder();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const editorViewItem = page.getByRole('menuitemcheckbox', { name: 'Editor', exact: true });
  await editorViewItem.click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Editor', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect.poll(outerTabOrder).toEqual(tabOrderBeforeClose);
  await page.keyboard.press('Escape');
  await viewerTab.click();
  expect(await canvas.evaluate((element) => element === window.__originalViewerCanvas)).toBe(true);

  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Reset workspace layout', exact: true }).click();
  expect(await canvas.evaluate((element) => element === window.__originalViewerCanvas)).toBe(true);
  await expect(configTab).toBeVisible();

  await editorTab.locator('.dv-default-tab-action').click();
  await expect(editor).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('shader-studio.standalone-layout.v1'));
    return Object.keys(saved.panels).sort();
  })).toEqual(['config', 'explorer', 'preview']);
  await page.reload();
  await expect(preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)')).toBeVisible();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Editor', exact: true }).click();
  await expect(editor.locator('.monaco-editor')).toBeVisible();
});


test('tool panels dock with the editor, restore their group, and close and reopen independently', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shader-option-aurora-glsl').click();
  const tab = (name) => page.locator('.dv-tab').filter({ hasText: new RegExp(`^${name}$`) });
  const preview = page.getByTestId('web-preview');
  await preview.getByLabel('Toggle config panel').click();
  const config = tab('Config');
  await expect(config).toBeVisible();
  await config.dragTo(tab('aurora.glsl'));
  const groupTitles = () => config.evaluate((element) =>
    [...element.closest('.dv-tabs-container').querySelectorAll('.dv-default-tab-content')].map((label) => label.textContent));
  await expect.poll(groupTitles).toEqual(expect.arrayContaining(['Config', 'aurora.glsl']));
  await expect(preview.getByLabel('Toggle config panel')).toHaveClass(/active/);
  // Existing users may have a saved Viewer panel; preserve its group while
  // migrating to the single top-level Preview.
  await page.evaluate(() => {
    const key = 'shader-studio.standalone-layout.v1';
    const saved = localStorage.getItem(key);
    localStorage.setItem(key, saved.replaceAll('"preview"', '"viewer"').replaceAll('"Preview"', '"Viewer"'));
  });
  await page.reload();
  await expect(config).toBeVisible();
  await expect.poll(groupTitles).toEqual(expect.arrayContaining(['Config', 'aurora.glsl']));
  await config.click();
  await expect(page.locator('.config-panel')).toBeVisible();
  await tab('aurora.glsl').click();
  // Starting the drag activates Config, hiding Editor. Drag to the shared
  // group's screen edge; Dockview renders content in a separate overlay.
  const groupContent = config.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " dv-groupview ")]').locator('.dv-content-container');
  const editorBounds = await groupContent.boundingBox();
  const configBounds = await config.boundingBox();
  await page.mouse.move(configBounds.x + configBounds.width / 2, configBounds.y + configBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(editorBounds.x + editorBounds.width - 10, editorBounds.y + editorBounds.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(groupTitles).toEqual(['Config']);
  await expect(page.getByTestId('web-editor')).toBeVisible();
  await expect(page.locator('.config-panel')).toBeVisible();
  await config.locator('.dv-default-tab-action').click();
  await expect(config).toHaveCount(0);
  await expect(preview.getByLabel('Toggle config panel')).not.toHaveClass(/active/);
  await preview.getByLabel('Toggle config panel').click();
  await expect(config).toBeVisible();

  for (const [name, control] of [['Debug', 'Toggle debug mode'], ['Export', 'Toggle export panel'], ['Frame Times', null]]) {
    const toggle = async () => {
      if (control) {
        await preview.getByLabel(control).click();
      } else {
        await preview.getByLabel('Change FPS limit').click();
        await page.getByRole('button', { name: /Frame Times$/ }).click();
      }
    };
    await toggle();
    const tool = tab(name);
    await expect(tool).toBeVisible();
    await tool.dragTo(tab('aurora.glsl'));
    await expect.poll(() => tool.evaluate((element) =>
      [...element.closest('.dv-tabs-container').querySelectorAll('.dv-default-tab-content')].map((label) => label.textContent)))
      .toEqual(expect.arrayContaining([name, 'aurora.glsl']));
    await tool.locator('.dv-default-tab-action').click();
    await expect(tool).toHaveCount(0);
    await toggle();
    await expect(tool).toBeVisible();
  }
});

test('shader explorer context menu extends beyond the dock and remains clickable', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('shader-option-nebula-texture-glsl');
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  await card.click({ button: 'right', position: { x: bounds.width - 5, y: bounds.height / 2 } });
  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  const explorerBounds = await page.getByTestId('web-shader-explorer').boundingBox();
  const rename = menu.getByRole('button', { name: 'Rename', exact: true });
  const buttonBounds = await rename.boundingBox();
  const x = buttonBounds.x + buttonBounds.width - 8;
  const y = buttonBounds.y + buttonBounds.height / 2;
  expect(x).toBeGreaterThan(explorerBounds.x + explorerBounds.width);
  expect(await rename.evaluate((button, point) => button.contains(document.elementFromPoint(point.x, point.y)), { x, y })).toBe(true);
  page.once('dialog', (dialog) => dialog.accept('renamed-texture.glsl'));
  await page.mouse.click(x, y);
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('shader-option-renamed-texture-glsl')).toBeVisible();
  // Workspace writes are queued asynchronously; reload once IndexedDB has committed the rename.
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('shader-studio-web', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const read = database.transaction('state', 'readonly').objectStore('state').get('workspace');
      read.onerror = () => {
        database.close(); reject(read.error);
      };
      read.onsuccess = () => {
        database.close();
        resolve(read.result?.some((file) => file.path.endsWith('/renamed-texture.glsl')) ?? false);
      };
    };
  }))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('shader-option-renamed-texture-glsl')).toBeVisible();
});

test('forks a shader from the preview menu and persists the independent copy', async ({ page }) => {
  await page.goto('/');
  const original = page.getByTestId('shader-option-nebula-texture-glsl');
  const fork = page.getByTestId('shader-option-nebula-texture-1-glsl');
  const editor = page.getByTestId('web-editor');
  await original.click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default texture');

  await page.getByLabel('Open options menu').click();
  await page.getByLabel('Fork shader', { exact: true }).click();

  await expect(fork).toBeVisible();
  await expect(fork).toHaveAttribute('aria-pressed', 'true');
  await expect(original).toHaveAttribute('aria-pressed', 'false');
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default texture');
  await expect(fork.locator('.shader-thumbnail img')).toBeVisible();
  await expect(fork.locator('.shader-error')).toHaveCount(0);

  const editedSource = 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.25); } // fork-only edit';
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await editor.locator('.inputarea').press('ControlOrMeta+A');
  await page.keyboard.insertText(editedSource);
  // Wait for the actual persisted edit before navigating away or reloading.
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('shader-studio-web', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const read = database.transaction('state', 'readonly').objectStore('state').get('workspace');
      read.onerror = () => {
        database.close(); reject(read.error);
      };
      read.onsuccess = () => {
        database.close();
        const files = read.result ?? [];
        const source = files.find((file) => file.path.endsWith('/nebula-texture.glsl'));
        const copy = files.find((file) => file.path.endsWith('/nebula-texture.1.glsl'));
        const config = files.find((file) => file.path.endsWith('/nebula-texture.sha.json'));
        const copyConfig = files.find((file) => file.path.endsWith('/nebula-texture.1.sha.json'));
        resolve(Boolean(copy?.contents.includes('fork-only edit')
          && source && !source.contents.includes('fork-only edit')
          && config && copyConfig?.contents === config.contents));
      };
    };
  }))).toBe(true);

  await page.reload();
  await expect(fork).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('.view-lines')).toContainText('fork-only edit');
  await original.click();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default texture');
  await expect(editor.locator('.view-lines')).not.toContainText('fork-only edit');
});


test('selecting shaders leaves their modification times unchanged after reload', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  const readShaders = () => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('shader-studio-web', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const read = database.transaction('state', 'readonly').objectStore('state').get('workspace');
      read.onerror = () => {
        database.close(); reject(read.error);
      };
      read.onsuccess = () => {
        database.close();
        resolve(read.result.filter((file) => /\.(glsl|slang)$/.test(file.path)));
      };
    };
  }));
  const before = await readShaders();
  for (const [id, text] of [
    ['nebula-texture-glsl', 'Shader Studio default texture'],
    ['desert-cubemap-glsl', 'Shader Studio default cubemap'],
  ]) {
    const card = page.getByTestId(`shader-option-${id}`);
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.locator('.view-lines')).toContainText(text);
    // Observe beyond the editor's 500ms persistence debounce.
    await page.waitForTimeout(750);
    expect(await readShaders()).toEqual(before);
  }
  await page.reload();
  await expect(page.getByTestId('shader-option-desert-cubemap-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio default cubemap');
  expect(await readShaders()).toEqual(before);
});

test('explicitly opens independent file editors and restores them after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).check();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  const aurora = page.locator('[data-testid="file-editor"][data-path="/shaders/aurora.glsl"]');
  await expect(aurora.locator('.monaco-editor')).toBeVisible();
  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  const desert = page.locator('[data-testid="file-editor"][data-path="/shaders/desert-cubemap.glsl"]');
  await expect(desert.locator('.monaco-editor')).toBeVisible();
  await expect(aurora.locator('.monaco-editor')).toBeVisible();
  await expect(aurora).toContainText('Shader Studio Aurora');
  await aurora.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('// independent editor edit\n');
  await expect(aurora).toContainText('independent editor edit');
  await expect(page.getByTestId('shader-option-aurora-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(desert).toContainText('mainImage');
  await page.getByTestId('shader-option-aurora-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  await expect(page.getByTestId('file-editor')).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('file-editor')).toHaveCount(2);
  await expect(aurora.locator('.monaco-editor')).toBeVisible();
  await expect(desert.locator('.monaco-editor')).toBeVisible();
  await expect(aurora).toContainText('independent editor edit');
  await page.locator('.dv-tab').filter({ hasText: /^desert-cubemap.glsl$/ }).locator('.dv-default-tab-action').click();
  await expect(desert).toHaveCount(0);
  await expect(aurora.locator('.monaco-editor')).toBeVisible();
  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  await expect(desert.locator('.monaco-editor')).toBeVisible();
  await expect(aurora).toContainText('independent editor edit');
});

test('keeps a buffer and its image shader open in separate editors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const read = store.get('workspace');
      read.onsuccess = () => {
        const files = read.result;
        const add = (path, contents) => files.push({ path, contents, createdAt: Date.now(), modifiedAt: Date.now() });
        add('/shaders/test-buffer.glsl', '// buffer source\nvoid mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }');
        add('/shaders/test-image.glsl', '// image source\nvoid mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy); }');
        add('/shaders/test-image.sha.json', JSON.stringify({ version: '1.0', passes: {
          'Buffer A': { path: 'test-buffer.glsl', inputs: {} },
          Image: { inputs: { iChannel0: { type: 'buffer', source: 'Buffer A' } } },
        } }));
        store.put(files, 'workspace');
      };
      tx.oncomplete = () => {
        db.close(); resolve();
      };
      tx.onerror = () => {
        db.close(); reject(tx.error);
      };
    };
  }));
  await page.reload();
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).check();
  await page.getByLabel('Hide Buffers', { exact: true }).uncheck();
  await page.getByTestId('shader-option-test-buffer-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  const buffer = page.locator('[data-testid="file-editor"][data-path="/shaders/test-buffer.glsl"]');
  await expect(buffer.locator('.monaco-editor')).toBeVisible();
  await page.getByTestId('shader-option-test-image-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  const image = page.locator('[data-testid="file-editor"][data-path="/shaders/test-image.glsl"]');
  await expect(image).toContainText('image source');
  await expect(buffer).toContainText('buffer source');
  await buffer.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('// buffer edit\n');
  await expect(buffer).toContainText('buffer edit');
  await expect(image).not.toContainText('buffer edit');
  await expect(page.getByTestId('shader-option-test-buffer-glsl')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(buffer).toContainText('buffer edit');
  await expect(image).toContainText('image source');
});

for (const theme of ['light', 'dark']) {
  test(`editor cursor and diagnostic hover are readable in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('shader-studio-theme', value), theme);
    await page.goto('/');
    const editor = page.getByTestId('web-editor');
    await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('void mainImage(out vec4 color, in vec2 coord) {\n  color = missingName;\n}');
    await page.keyboard.press('ArrowUp');
    const cursor = editor.locator('.cursor').first();
    await expect(cursor).toHaveCSS('background-color', theme === 'light' ? 'rgb(31, 31, 31)' : 'rgb(255, 255, 255)');
    const squiggle = editor.locator('.squiggly-error').first();
    await expect(squiggle).toBeVisible();
    const diagnosticBounds = await squiggle.boundingBox();
    await page.mouse.move(diagnosticBounds.x + diagnosticBounds.width / 2, diagnosticBounds.y + diagnosticBounds.height / 2);
    const hover = page.locator('.monaco-hover:visible');
    await expect(hover).toBeVisible();
    await expect(hover).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(30, 30, 30)');
  });
}

for (const separate of [false, true]) {
  for (const language of ['glsl', 'slang']) {
    test(`typing offers ${language} completions in ${separate ? 'separate' : 'main'} editor`, async ({ page }) => {
      await page.goto('/');
      if (separate) {
        await page.getByTitle('Options', { exact: true }).click();
        await page.getByLabel('Open Files', { exact: true }).check();
      }
      await page.getByTestId(language === 'slang' ? 'shader-option-aurora-slang-slang' : 'shader-option-aurora-glsl').click();
      const editor = separate ? page.getByTestId('file-editor') : page.getByTestId('web-editor');
      await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(language === 'glsl'
        ? 'void mainImage(out vec4 color, in vec2 coord) {\n  '
        : 'float4 mainImage(float2 coord) {\n  ');
      await page.keyboard.type('norm', { delay: 100 });
      const suggestions = page.locator('.suggest-widget:visible');
      await expect(suggestions).toBeVisible();
      await expect(suggestions).toContainText('normalize');
      await expect(suggestions).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const box = await suggestions.boundingBox();
      expect(await suggestions.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
        { x: box.x + box.width / 2, y: box.y + 10 })).toBe(true);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Space');
      await expect(suggestions).toContainText('normalize');
      await suggestions.getByRole('option').filter({ hasText: /^normalize/ }).first().click();
      await expect(editor.locator('.view-lines')).toContainText('normalize');
    });
  }
}

test('explorer Open Files reuses one editor and only reopens it when checked', async ({ page }) => {
  await page.goto('/');
  const editorTab = page.locator('.dv-tab').filter({ hasText: /\.(glsl|frag|slang)$/ });
  const editor = page.getByTestId('web-editor');
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).check();
  for (const [id, text] of [
    ['aurora-glsl', 'Shader Studio Aurora'],
    ['desert-cubemap-glsl', 'Shader Studio default cubemap'],
    ['nebula-texture-glsl', 'Shader Studio default texture'],
  ]) {
    await page.getByTestId(`shader-option-${id}`).click();
    await expect(editor.locator('.view-lines')).toContainText(text);
    await expect(editorTab).toHaveCount(1);
    await expect(editorTab).toHaveText(id.replace(/-glsl$/, '.glsl'));
    await expect(page.getByTestId('file-editor')).toHaveCount(0);
  }
  await page.getByLabel('Open Files', { exact: true }).uncheck();
  await editorTab.locator('.dv-default-tab-action').click();
  await expect(editorTab).toHaveCount(0);
  await page.getByTestId('shader-option-aurora-glsl').click();
  await expect(page.getByTestId('shader-option-aurora-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(editorTab).toHaveCount(0);
  await expect(editor).not.toBeVisible();
  await expect(page.getByTestId('file-editor')).toHaveCount(0);
  await page.reload();
  await expect(editorTab).toHaveCount(0);
  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await expect(page.getByTestId('shader-option-desert-cubemap-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(editorTab).toHaveCount(0);
  await expect(editor).not.toBeVisible();
  await expect(page.getByLabel('Open Files', { exact: true })).not.toBeChecked();
  await page.getByLabel('Open Files', { exact: true }).check();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await expect(editorTab).toHaveCount(1);
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(editor.locator('.view-lines')).toContainText('Shader Studio Aurora');
  await expect(page.getByTestId('file-editor')).toHaveCount(0);
});


test('config double clicks open and focus standalone file editors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const read = store.get('workspace');
      read.onsuccess = () => {
        const files = read.result;
        const file = files.find((file) => file.path === '/shaders/glow-trails.sha.json');
        const config = JSON.parse(file.contents);
        config.script = '../navigation-script.ts';
        config.passes.Image.vertex = 'navigation-vertex.glsl';
        config.passes.common = { path: 'navigation-common.glsl' };
        file.contents = JSON.stringify(config);
        for (const [path, contents] of [
          ['/navigation-script.ts', '// navigation script'],
          ['/shaders/navigation-vertex.glsl', '// navigation vertex'],
          ['/shaders/navigation-common.glsl', '// navigation common'],
        ]) files.push({ path, contents, createdAt: Date.now(), modifiedAt: Date.now() });
        store.put(files, 'workspace');
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();
  await page.getByTestId('shader-option-glow-trails-glsl').click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  const trails = page.locator('[data-tab-name="Trails"]');
  await trails.dblclick();
  const editor = page.locator('[data-testid="file-editor"][data-path="/shaders/glow-trails/trails.buffer.glsl"]');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await page.locator('[data-tab-name="Glow"]').dblclick();
  await expect(page.locator('[data-testid="file-editor"][data-path="/shaders/glow-trails/glow.buffer.glsl"] .monaco-editor')).toBeVisible();
  await trails.dblclick();
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(editor).toHaveCount(1);
  for (const [tab, path] of [
    ['Common', '/shaders/navigation-common.glsl'],
    ['Script', '/navigation-script.ts'],
    ['Image', '/shaders/glow-trails.glsl'],
  ]) {
    await page.locator(`[data-tab-name="${tab}"]`).dblclick();
    await expect(page.locator(`[data-testid="file-editor"][data-path="${path}"] .monaco-editor`)).toBeVisible();
  }
  await page.getByRole('heading', { name: 'Vertex shader', exact: true }).dblclick();
  await expect(page.locator('[data-testid="file-editor"][data-path="/shaders/navigation-vertex.glsl"] .monaco-editor')).toBeVisible();
  await page.reload();
  await expect(editor.locator('.monaco-editor')).toBeVisible();
});


test('focused standalone file editor selects the preview and persists after reload', async ({ page }) => {
  await page.goto('/');
  const aurora = page.getByTestId('shader-option-aurora-glsl');
  const desert = page.getByTestId('shader-option-desert-cubemap-glsl');
  await aurora.click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  const editor = page.locator('[data-testid="file-editor"][data-path="/shaders/aurora.glsl"]');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).uncheck();
  await desert.click();
  await expect(desert).toHaveAttribute('aria-pressed', 'true');
  await editor.locator('.view-lines').click();
  await expect(aurora).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('Shader Studio Aurora');
  await desert.click();
  await page.locator('.dv-tab').filter({ hasText: /^aurora\.glsl$/ }).click();
  await expect(aurora).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(aurora).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
});


test('double-clicking buffers reuses the editor tab group and focuses the requested buffer', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shader-option-glow-trails-glsl').click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  const editorGroup = page.locator('.dv-groupview').filter({ has: page.locator('.dv-tab').filter({ hasText: /^glow-trails\.glsl$/ }) });
  const tabs = editorGroup.locator('.dv-tab');
  const fileEditor = (name) => page.locator(`[data-testid="file-editor"][data-path="/shaders/glow-trails/${name}.buffer.glsl"]`);
  for (const name of ['Trails', 'Glow', 'Trails']) {
    await page.locator(`[data-tab-name="${name}"]`).dblclick();
    await expect(tabs.filter({ hasText: new RegExp(`^${name.toLowerCase()}\\.buffer\\.glsl$`) })).toHaveClass(/dv-active-tab/);
    await expect(fileEditor(name.toLowerCase()).locator('.monaco-editor')).toBeVisible();
  }
  await expect(tabs).toHaveCount(3);
  await expect(fileEditor('glow')).not.toBeInViewport();
  await page.reload();
  const restoredTabs = page.locator('.dv-groupview').filter({
    has: page.locator('.dv-tab').filter({ hasText: /^glow\.buffer\.glsl$/ }),
  }).locator('.dv-tab');
  await expect(restoredTabs).toHaveCount(3);
  await expect(fileEditor('trails').locator('.monaco-editor')).toBeVisible();
  await restoredTabs.filter({ hasText: /^glow\.buffer\.glsl$/ }).click();
  await expect(fileEditor('glow').locator('.monaco-editor')).toBeVisible();
});

for (const first of ['config', 'debug']) {
  test(`Config and Debug share their opening group (${first} first)`, async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('shader-option-aurora-glsl').click();
    const preview = page.getByTestId('web-preview');
    const toggle = (id) => preview.getByLabel(id === 'config' ? 'Toggle config panel' : 'Toggle debug mode').click();
    const tab = (name) => page.locator('.dv-tab').filter({ hasText: new RegExp(`^${name}$`) });
    const groupTitles = () => tab('Config').evaluate((element) =>
      [...element.closest('.dv-tabs-container').querySelectorAll('.dv-default-tab-content')].map((label) => label.textContent));
    await toggle(first);
    await toggle(first === 'config' ? 'debug' : 'config');
    await expect.poll(groupTitles).toEqual(['Config', 'Debug']);
    await expect(page.locator(first === 'config' ? '.debug-panel' : '.config-panel')).toBeVisible();
    await tab('Config').click();
    await tab('Config').locator('.dv-default-tab-action').click();
    await toggle('config');
    await expect.poll(groupTitles).toEqual(['Config', 'Debug']);
    await expect(page.locator('.config-panel')).toBeVisible();
    await page.reload();
    await expect(tab('Config')).toBeVisible();
    await expect.poll(groupTitles).toEqual(['Config', 'Debug']);
  });
}


test('shader selection updates the last active editor and restores it after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shader-option-aurora-glsl').click();
  await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
  const fileEditor = page.getByTestId('file-editor');
  await expect(fileEditor.locator('.monaco-editor')).toBeVisible();
  await fileEditor.locator('.view-lines').click();
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).check();
  await page.getByTestId('shader-option-desert-cubemap-glsl').click();
  await expect(fileEditor).toHaveCount(1);
  await expect(fileEditor).toHaveAttribute('data-path', '/shaders/desert-cubemap.glsl');
  await expect(fileEditor.locator('.view-lines')).toContainText('Shader Studio default cubemap');
  await page.reload();
  await expect(fileEditor).toHaveAttribute('data-path', '/shaders/desert-cubemap.glsl');
  await expect(fileEditor.locator('.monaco-editor')).toBeVisible();
});


test('explorer can resize beyond 260 pixels and retains its width after reload', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  await expect(explorer).toBeVisible();
  const box = await explorer.boundingBox();
  expect(box.width).toBe(260);
  await page.mouse.move(box.x + box.width, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await explorer.boundingBox()).width).toBeGreaterThan(350);
  const resizedWidth = (await explorer.boundingBox()).width;
  await expect.poll(() => page.evaluate(() => localStorage.getItem('shader-studio.standalone-layout.v1'))).not.toBeNull();
  await page.reload();
  await expect(explorer).toBeVisible();
  await expect.poll(async () => Math.abs((await explorer.boundingBox()).width - resizedWidth)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Reset workspace layout', exact: true }).click();
  await expect.poll(async () => (await explorer.boundingBox()).width).toBe(260);
});


test('replacing the active editor preserves tab order after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shader-option-glow-trails-glsl').click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  for (const name of ['Trails', 'Glow']) {
    await page.locator(`[data-tab-name="${name}"]`).dblclick();
    await expect(page.locator(`[data-testid="file-editor"][data-path="/shaders/glow-trails/${name.toLowerCase()}.buffer.glsl"] .monaco-editor`)).toBeVisible();
  }
  const group = page.locator('.dv-groupview').filter({
    has: page.locator('.dv-tab').filter({ hasText: /^glow\.buffer\.glsl$/ }),
  });
  const titles = group.locator('.dv-tab .dv-default-tab-content');
  await expect(titles).toHaveText(['glow-trails.glsl', 'trails.buffer.glsl', 'glow.buffer.glsl']);
  await group.locator('.dv-tab').filter({ hasText: /^trails\.buffer\.glsl$/ }).click();
  await page.getByTitle('Options', { exact: true }).click();
  await page.getByLabel('Open Files', { exact: true }).check();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await expect(titles).toHaveText(['glow-trails.glsl', 'aurora.glsl', 'glow.buffer.glsl']);
  await expect(page.locator('[data-testid="file-editor"][data-path="/shaders/aurora.glsl"] .view-lines')).toContainText('Shader Studio Aurora');
  await page.reload();
  // The main editor follows the restored preview; the file editors retain their slots.
  await expect(titles).toHaveText(['aurora.glsl', 'aurora.glsl', 'glow.buffer.glsl']);
});


for (const format of ['PNG', 'JPEG', 'WebM', 'MP4', 'GIF']) {
  test(`exports a standalone ${format} download`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.getByTestId('shader-option-aurora-glsl').click();
    await page.getByLabel('Toggle export panel').click();
    const screenshot = format === 'PNG' || format === 'JPEG';
    await page.getByRole('button', { name: screenshot ? 'Screenshot' : format === 'GIF' ? 'GIF' : 'Video', exact: true }).click();
    if (format !== 'GIF') await page.getByRole('button', { name: format, exact: true }).click();
    if (!screenshot) await page.locator('input[min="0.5"][step="0.5"]').fill('0.5');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: screenshot ? 'Capture' : 'Record', exact: true }).click();
    const download = await downloadPromise;
    const extension = format === 'JPEG' ? 'jpg' : format.toLowerCase();
    expect(download.suggestedFilename()).toMatch(new RegExp(`^shader-.*\\.${extension}$`));
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(100);
    if (format === 'PNG') expect(PNG.sync.read(bytes).width).toBeGreaterThan(0);
    if (format === 'JPEG') expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
    if (format === 'WebM') expect([...bytes.subarray(0, 4)]).toEqual([26, 69, 223, 163]);
    if (format === 'MP4') expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
    if (format === 'GIF') expect(bytes.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
    expect(pageErrors).toEqual([]);
  });
}


test('standalone defaults to Aurora GLSL and preserves a later selection on reload', async ({ page }) => {
  await page.goto('/');
  const aurora = page.getByTestId('shader-option-aurora-glsl');
  await expect(aurora).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('mainImage');
  await page.reload();
  await expect(aurora).toHaveAttribute('aria-pressed', 'true');
  const desert = page.getByTestId('shader-option-desert-cubemap-glsl');
  await desert.click();
  await expect(desert).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(desert).toHaveAttribute('aria-pressed', 'true');
  await expect(aurora).toHaveAttribute('aria-pressed', 'false');
});

test('pressing Enter after an open brace indents the new line like VS Code', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  const editor = page.getByTestId('web-editor');
  await explorer.getByTitle('New Shader').click();
  await page.getByRole('dialog', { name: 'New Shader' }).getByLabel('Shader name').fill('indent-check');
  await page.getByRole('button', { name: 'Create Shader', exact: true }).click();
  await expect(page.getByTestId('shader-option-indent-check-glsl')).toBeVisible();
  await expect(editor.locator('.monaco-editor')).toBeVisible();

  const editorInput = editor.locator('.inputarea');
  await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
  await editorInput.press('ControlOrMeta+A');
  await page.keyboard.type('void main() {');
  await editorInput.press('Enter');
  await page.keyboard.type('float x;');

  const lines = async () => editor.locator('.view-line').evaluateAll((elements) => elements
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .map((element) => element.textContent.replace(/ /g, ' ')));

  // The brace auto-closes, Enter indents the body, and the closing brace
  // drops back to column 0.
  await expect.poll(lines).toEqual([
    'void main() {',
    expect.stringMatching(/^ {2,}float x;$/),
    '}',
  ]);
});

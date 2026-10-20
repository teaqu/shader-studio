import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';
import { EXPLORER_STATE_KEY, useSharedShaderEditor } from './explorer-preferences.mjs';

test.beforeEach(({ context }) => useSharedShaderEditor(context));

const GLSL_SOURCE = `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(coord, 0.0, 1.0);
}`;

function editor(page) {
  return page.getByTestId('web-editor');
}

function activeEditor(page) {
  return editor(page).locator('[data-editor-engine]');
}

async function openSettings(page) {
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  if (await nav.isVisible()) {
    await nav.getByRole('button', { name: 'Studio', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

async function closeSettings(page) {
  await page.keyboard.press('Escape');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  if (await nav.isVisible()) {
    await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  }
}

async function chooseEditor(page, label, engine) {
  const settings = await openSettings(page);
  await settings.getByLabel(label, { exact: true }).selectOption(engine);
  // Editor choices take effect as soon as their select changes. Closing with
  // Escape avoids a click racing the selected engine's synchronous remount.
  await closeSettings(page);
  await expect(settings).toBeHidden();
}

async function openFixture(page, files = [
  ['editor-engine.glsl', GLSL_SOURCE],
  ['editor-engine.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
], shaderTestId = 'shader-option-editor-engine-glsl') {
  await page.route('**/__codemirror_editor_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
  await page.goto('/__codemirror_editor_fixture__');
  await workspace(page, files);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  if (await nav.isVisible()) {
    await nav.getByRole('button', { name: 'Studio', exact: true }).click();
  }
  await page.getByTestId(shaderTestId).click();
}

test('main WGSL file tabs recognize configured storage after opening and reloading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({ keepActiveShaderFiles: true }));
  }, EXPLORER_STATE_KEY);
  const source = `fn mainImage(coord: vec2f) -> vec4f {
  let value = f32(atomicLoad(&density[0]));
  return vec4f(value + missingIdentifier);
}`;
  await openFixture(page, [
    ['editor-storage.wgsl', source],
    ['editor-storage.sha.json', JSON.stringify({
      version: '1.0', storage: { density: { count: 1024, elementType: 'atomic<u32>' } },
      passes: { Image: { inputs: {} } },
    })],
  ], 'shader-option-editor-storage-wgsl');
  await page.getByRole('navigation', { name: 'Workspace panels' })
    .getByRole('button', { name: 'Editor', exact: true }).click();
  const fileEditor = page.locator('[data-testid="file-editor"][data-path="/editor-storage.wgsl"]');
  await expect(fileEditor.locator('[data-editor-engine]')).toHaveAttribute('data-editor-engine', 'codemirror');
  const errors = fileEditor.locator('.cm-lintRange-error');
  // An intentional unknown proves diagnostics ran; density must stay valid.
  await expect(errors).toHaveText(['missingIdentifier'], { timeout: 20_000 });
  await page.reload();
  await expect(errors).toHaveText(['missingIdentifier'], { timeout: 20_000 });
});

test('uses Monaco by default on desktop and switches engines without losing text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openFixture(page);
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'monaco');
  await expect(activeEditor(page).locator('.monaco-editor')).toBeVisible();
  const desktopOptions = editor(page).getByRole('toolbar', { name: 'Editor options', exact: true });
  await expect(desktopOptions.getByRole('button')).toHaveCount(2);
  await expect(desktopOptions.getByRole('button', { name: 'Wrap text' })).toBeVisible();
  await expect(desktopOptions.getByRole('button', { name: 'Enable Vim mode' })).toBeVisible();

  await chooseEditor(page, 'Desktop editor', 'codemirror');
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'codemirror');
  await expect(activeEditor(page).locator('.cm-editor')).toBeVisible();
  await expect(activeEditor(page).locator('.cm-content[contenteditable="true"]')).toContainText('mainImage');
  await expect(desktopOptions.getByRole('button')).toHaveCount(2);

  await chooseEditor(page, 'Desktop editor', 'monaco');
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'monaco');
  await expect(activeEditor(page).locator('.view-lines')).toContainText('mainImage');
  await page.reload();
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'monaco');
});

test('uses CodeMirror by default on a phone and retains edits across engine switches and reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'codemirror');
  const content = activeEditor(page).locator('.cm-content[contenteditable="true"]');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(`${GLSL_SOURCE} // mobile CodeMirror edit`);
  await expect(content).toContainText('mobile CodeMirror edit');

  await chooseEditor(page, 'Mobile editor', 'monaco');
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'monaco');
  await expect(activeEditor(page).locator('.view-lines')).toContainText('mobile CodeMirror edit');

  await chooseEditor(page, 'Mobile editor', 'codemirror');
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'codemirror');
  await expect(activeEditor(page).locator('.cm-content')).toContainText('mobile CodeMirror edit');
  await page.reload();
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(activeEditor(page)).toHaveAttribute('data-editor-engine', 'codemirror');
  await expect(activeEditor(page).locator('.cm-content')).toContainText('mobile CodeMirror edit');
});

test('CodeMirror supports editing, undo, search, autocomplete, and language diagnostics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  const cm = activeEditor(page).locator('.cm-editor');
  const content = cm.locator('.cm-content[contenteditable="true"]');
  await expect(content).toContainText('mainImage');

  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// temporary CodeMirror text');
  await expect(content).toContainText('temporary CodeMirror text');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(content).not.toContainText('temporary CodeMirror text');

  await page.keyboard.press('ControlOrMeta+f');
  await expect(cm.locator('.cm-search')).toBeVisible();
  await page.keyboard.type('mainImage');
  await expect(cm.locator('.cm-search input').first()).toHaveValue('mainImage');
  await page.keyboard.press('Escape');

  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(GLSL_SOURCE);
  const caret = GLSL_SOURCE.indexOf('coord,') + 'coord'.length;
  for (let count = GLSL_SOURCE.length - caret; count > 0; count--) {
    await page.keyboard.press('ArrowLeft');
  }
  await page.keyboard.type('.');
  await page.keyboard.press('ControlOrMeta+Space');
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('void mainImage(out vec4 color, in vec2 coord) { color = missingIdentifier; }');
  await expect(cm.locator('.cm-diagnostic, .cm-lintRange-error')).toBeVisible({ timeout: 20_000 });
  await cm.locator('.cm-lintRange-error').first().hover();
  const tooltip = page.locator('.cm-tooltip-hover').filter({ has: page.locator('.cm-diagnostic') });
  await expect(tooltip).toBeVisible();
  await expect.poll(async () => tooltip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const message = element.querySelector('.cm-tooltip-lint').getBoundingClientRect();
    return bounds.height - message.height;
  })).toBeLessThan(30);
  await expect.poll(async () => tooltip.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(200);
});

test('mobile font prevents focus zoom, respects larger preferences, and survives reload and rotation', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  const cm = activeEditor(page).locator('.cm-editor');
  const content = cm.locator('.cm-content[contenteditable="true"]');
  const initialScale = await page.evaluate(() => visualViewport.scale);

  async function checkEditingFont(size) {
    await expect(content).toHaveCSS('font-size', `${size}px`);
    if (isMobile) {
      await content.tap();
    } else {
      await content.click();
    }
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n// phone focus zoom regression');
    await expect(content).toContainText('phone focus zoom regression');
    await expect.poll(() => page.evaluate(() => visualViewport.scale)).toBe(initialScale);
    await page.keyboard.press('ControlOrMeta+f');
    const search = cm.locator('.cm-search input').first();
    await expect(search).toHaveCSS('font-size', `${size}px`);
    await search.fill('mainImage');
    await expect(search).toHaveValue('mainImage');
    await expect.poll(() => page.evaluate(() => visualViewport.scale)).toBe(initialScale);
    await page.keyboard.press('Escape');
  }

  await checkEditingFont(16);
  for (const preference of [8, 22]) {
    const settings = await openSettings(page);
    await settings.getByLabel('Font size', { exact: true }).fill(String(preference));
    await page.keyboard.press('Tab');
    await closeSettings(page);
    await checkEditingFont(Math.max(16, preference));
  }

  await page.reload();
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  await checkEditingFont(22);
  if (isMobile) {
    const settings = await openSettings(page);
    await settings.getByLabel('Font size', { exact: true }).fill('14');
    await page.keyboard.press('Tab');
    await closeSettings(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(content).toHaveCSS('font-size', '16px');
  }
});

test('desktop font keeps the configured size when CodeMirror is selected', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openFixture(page);
  await chooseEditor(page, 'Desktop editor', 'codemirror');
  const content = activeEditor(page).locator('.cm-content');
  await expect(content).toHaveCSS('font-size', '14px');
  const settings = await openSettings(page);
  await settings.getByLabel('Font size', { exact: true }).fill('12');
  await page.keyboard.press('Tab');
  await closeSettings(page);
  await expect(content).toHaveCSS('font-size', '12px');
});

test('mobile bottom toolbar follows a panned keyboard viewport without leaving blank editor space', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Desktop WebKit cannot open the iPhone keyboard. Simulate its independent
  // viewport size/offset here; the native keyboard still needs device testing.
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1,
    });
    const fullHeight = window.innerHeight;
    let innerHeight = fullHeight;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerHeight });
    window.setKeyboardViewport = (height, offsetTop) => {
      innerHeight = height;
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    };
    window.restoreKeyboardViewport = () => window.setKeyboardViewport(fullHeight, 0);
  });
  await openFixture(page);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  const content = activeEditor(page).locator('.cm-content[contenteditable="true"]');
  const shell = page.locator('.standalone-app');
  const fullHeight = (await shell.boundingBox()).height;
  await content.click();
  await page.evaluate(() => window.setKeyboardViewport(400, 100));
  await expect(nav).toBeHidden();
  const quickNav = page.getByRole('navigation', { name: 'Editor and preview' });
  await expect(quickNav).toBeVisible();
  await expect(quickNav.getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => shell.evaluate(element => ({
    top: element.getBoundingClientRect().top,
    height: element.getBoundingClientRect().height,
  }))).toEqual({ top: 100, height: fullHeight - 100 });
  const pageScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(pageScrollHeight).toBeLessThanOrEqual(fullHeight);
  const cm = activeEditor(page).locator('.cm-editor');
  await expect.poll(async () => {
    const shellBounds = await shell.boundingBox();
    const codeBounds = await cm.boundingBox();
    return Math.abs(shellBounds.y + shellBounds.height - codeBounds.y - codeBounds.height);
  }).toBeLessThanOrEqual(1);
  const keys = activeEditor(page).getByRole('button', { name: 'Show keyboard toolbar' });
  await expect.poll(async () => {
    const box = await keys.boundingBox();
    return Math.round(box.y + box.height);
  }).toBe(494);
  // The editor continues beyond the visible controls, filling the area that
  // Safari may expose behind its translucent bottom chrome.
  expect((await cm.boundingBox()).y + (await cm.boundingBox()).height).toBeGreaterThan(500);
  await keys.click();
  const toolbar = activeEditor(page).getByRole('toolbar', { name: 'Editor options', exact: true });
  const switchBounds = await quickNav.boundingBox();
  const toolbarBounds = await toolbar.boundingBox();
  expect(toolbarBounds.x).toBeGreaterThanOrEqual(switchBounds.x + switchBounds.width);
  expect(Math.abs(toolbarBounds.y + toolbarBounds.height - switchBounds.y - switchBounds.height)).toBeLessThanOrEqual(1);
  await toolbar.getByRole('button', { name: 'More editing options', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Hide Editor and Preview tabs' }).click();
  await expect(quickNav).toBeHidden();
  await expect(nav).toBeHidden();
  await expect.poll(async () => (await toolbar.boundingBox()).x).toBeLessThan(toolbarBounds.x);
  await toolbar.getByRole('button', { name: 'Show Editor and Preview tabs' }).click();
  await expect(quickNav).toBeVisible();
  await toolbar.getByRole('button', { name: 'More editing options', exact: true }).click();
  const code = await content.innerText();
  await quickNav.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('web-preview')).toBeVisible();
  await expect(quickNav.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-current', 'page');
  await quickNav.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(content).toBeVisible();
  await expect(content).toHaveText(code);
  await page.evaluate(() => window.setKeyboardViewport(400, 160));
  await expect.poll(() => shell.evaluate(element => ({
    top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom,
  }))).toEqual({ top: 160, bottom: fullHeight });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageScrollHeight);
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  await content.evaluate(element => element.blur());
  await expect(nav).toBeHidden();
  await page.evaluate(() => window.restoreKeyboardViewport());
  await expect(nav).toBeVisible();
  await expect(quickNav).toBeHidden();
  await expect.poll(() => shell.evaluate(element => element.getBoundingClientRect().top)).toBe(0);
});

test('mobile bottom toolbar uses one key row and persists automatic suggestions', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  const toolbar = editor(page).getByRole('toolbar', { name: 'Editor options', exact: true });
  const more = toolbar.getByRole('button', { name: 'More editing options', exact: true });
  const content = activeEditor(page).locator('.cm-content[contenteditable="true"]');
  const actions = toolbar.getByRole('group', { name: 'More editing options', exact: true });
  const tap = control => isMobile ? control.tap() : control.click();
  const showKeys = toolbar.getByRole('button', { name: 'Show keyboard toolbar' });
  await expect(showKeys).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Insert ;', exact: true })).toBeHidden();
  const collapsedEditorHeight = (await activeEditor(page).locator('.cm-editor').boundingBox()).height;
  await content.click();
  await tap(showKeys);
  await expect(content).toBeFocused();
  expect((await activeEditor(page).locator('.cm-editor').boundingBox()).height).toBe(collapsedEditorHeight);
  await expect(actions).toBeHidden();
  await expect(toolbar.getByRole('button', { name: 'Insert ;', exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await toolbar.boundingBox();
    const codeBounds = await activeEditor(page).locator('.cm-editor').boundingBox();
    // Both states overlay the editor: code continues behind and below the keys.
    expect(bounds.y).toBeGreaterThan(codeBounds.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(codeBounds.y + codeBounds.height);
    expect(codeBounds.y + codeBounds.height - (bounds.y + bounds.height)).toBeLessThanOrEqual(8);
    expect(bounds.height).toBeLessThanOrEqual(38);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await toolbar.locator('.key-strip button').evaluateAll(buttons => new Set(buttons.map(button => button.getBoundingClientRect().top)).size)).toBe(1);
    const moreBounds = await more.boundingBox();
    expect(moreBounds.x + moreBounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }

  const cm = activeEditor(page).locator('.cm-editor');
  const gutter = cm.locator('.cm-gutters').first();
  const gutterBefore = await gutter.boundingBox();
  await cm.locator('.cm-scroller').evaluate(scroller => { scroller.scrollLeft = 100; });
  await expect.poll(async () => (await gutter.boundingBox()).x).toBeLessThan(gutterBefore.x - 50);
  await cm.locator('.cm-scroller').evaluate(scroller => { scroller.scrollLeft = 0; });

  await content.click();
  const before = await content.innerText();
  await tap(toolbar.getByRole('button', { name: 'Insert ;', exact: true }));
  await expect(content).toBeFocused();
  await expect(content).not.toHaveText(before);
  await tap(more);
  await expect(actions).toBeVisible();
  await expect(content).toBeFocused();
  await expect(actions.getByRole('button', { name: 'Search code' })).toBeHidden();
  await expect(actions.getByRole('button', { name: 'Compile shader' })).toBeHidden();
  await tap(actions.getByRole('button', { name: 'Undo', exact: true }));
  const wrap = actions.getByRole('button', { name: 'Wrap text' });
  await tap(wrap);
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await expect(content).toHaveClass(/cm-lineWrapping/);
  await tap(actions.getByRole('button', { name: 'Enable Vim mode' }));
  await expect(actions.getByRole('button', { name: 'Disable Vim mode' })).toHaveAttribute('aria-pressed', 'true');
  await tap(actions.getByRole('button', { name: 'Disable Vim mode' }));
  await tap(actions.getByRole('button', { name: 'Disable suggestions' }));
  await expect(actions.getByRole('button', { name: 'Enable suggestions' })).toHaveAttribute('aria-pressed', 'false');
  await expect(actions.getByRole('button', { name: 'Enable descriptions' })).toHaveAttribute('aria-pressed', 'false');
  await tap(actions.getByRole('button', { name: 'Enable descriptions' }));
  await expect(actions.getByRole('button', { name: 'Disable descriptions' })).toHaveAttribute('aria-pressed', 'true');
  await tap(actions.getByRole('button', { name: 'Hide Editor and Preview tabs' }));
  await expect(actions.getByRole('button', { name: 'Show Editor and Preview tabs' })).toHaveAttribute('aria-pressed', 'false');
  await content.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await nav.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(showKeys).toBeVisible();
  await tap(showKeys);
  await tap(more);
  await expect(actions.getByRole('button', { name: 'Show Editor and Preview tabs' })).toHaveAttribute('aria-pressed', 'false');
  await tap(actions.getByRole('button', { name: 'Show Editor and Preview tabs' }));
  await expect(actions.getByRole('button', { name: 'Hide Editor and Preview tabs' })).toHaveAttribute('aria-pressed', 'true');
  await expect(actions.getByRole('button', { name: 'Enable suggestions' })).toHaveAttribute('aria-pressed', 'false');
  await expect(actions.getByRole('button', { name: 'Disable descriptions' })).toHaveAttribute('aria-pressed', 'true');
  await tap(actions.getByRole('button', { name: 'Disable descriptions' }));
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await tap(actions.getByRole('button', { name: 'Enable suggestions' }));
  await expect(actions.getByRole('button', { name: 'Disable suggestions' })).toHaveAttribute('aria-pressed', 'true');
  await tap(actions.getByRole('button', { name: 'Hide keyboard' }));
  await expect(content).not.toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await tap(toolbar.getByRole('button', { name: 'Hide keyboard toolbar' }));
  await expect(showKeys).toBeVisible();
  await expect(more).toBeHidden();
  expect((await activeEditor(page).locator('.cm-editor').boundingBox()).height).toBe(collapsedEditorHeight);
  await chooseEditor(page, 'Mobile editor', 'monaco');
  await expect(editor(page).getByRole('button', { name: 'Wrap text' })).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Enable Vim mode' })).toBeVisible();
  await chooseEditor(page, 'Mobile editor', 'codemirror');
  await expect(showKeys).toBeVisible();
});

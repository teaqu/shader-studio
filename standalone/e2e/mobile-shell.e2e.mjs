import { expect, test } from '@playwright/test';

// Phone shell navigation with the default per-file editors (mobile.e2e.mjs
// opts into the shared editor instead).

test('the phone Editor shows the file editor a desktop session opened, and keeps it after reload', async ({ page }) => {
  // On desktop, opening shaders swaps the shared editor for per-file editors;
  // the phone Editor destination must follow them after narrowing the window.
  const phone = page.viewportSize();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.getByTestId('shader-option-aurora-glsl').click();
  await page.getByTestId('shader-option-nebula-texture-glsl').click();
  const editor = page.locator('[data-testid="file-editor"][data-path="/nebula-texture.glsl"]');
  await expect(editor.locator('.view-lines')).toContainText('mainImage');

  await page.setViewportSize(phone);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  // Dockview hides groups without emptying their boxes, so check what is on screen.
  await expect(editor.locator('.view-lines')).toBeInViewport();
  await expect(editor.locator('.view-lines')).toContainText('mainImage');

  await page.reload();
  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(editor.locator('.view-lines')).toBeInViewport();
});

test('Studio holds Shaders and Files, and reopens the section last used', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await expect(nav.getByRole('button')).toHaveText(['Studio', 'Editor', 'Preview', 'Tools']);
  await nav.getByRole('button', { name: 'Studio' }).click();
  const sections = page.getByRole('navigation', { name: 'Studio sections' });
  await expect(sections.getByRole('button', { name: 'Shaders' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('shader-option-aurora-glsl')).toBeVisible();

  await sections.getByRole('button', { name: 'Files' }).click();
  await expect(page.getByRole('treeitem', { name: 'aurora.glsl', exact: true })).toBeInViewport();
  await expect(page.getByTestId('shader-option-aurora-glsl')).not.toBeInViewport();
  await expect(nav.getByRole('button', { name: 'Studio' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('button', { name: 'Preview' }).click();
  await expect(sections).toBeHidden();
  await nav.getByRole('button', { name: 'Studio' }).click();
  await expect(sections.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('treeitem', { name: 'aurora.glsl', exact: true })).toBeVisible();
});

test('the phone tools include VR', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await expect(nav.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('web-preview').locator('canvas').first()).toBeVisible();

  await nav.getByRole('button', { name: 'Tools' }).click();
  await expect(page.getByRole('navigation', { name: 'Tools' }).getByRole('button'))
    .toHaveText(['Config', 'Debug', 'Frame Times', 'Export', 'VR']);
});

test('opening a shader from the phone Studio stays on Studio without revealing the editor', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Studio' }).click();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await page.getByTestId('shader-option-nebula-texture-glsl').click();

  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(nav.getByRole('button', { name: 'Studio' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toBeInViewport();
  // Dockview hides groups without emptying their boxes, so check what is on screen.
  const editor = page.locator('[data-testid="file-editor"][data-path="/nebula-texture.glsl"]');
  await expect(editor.locator('.view-lines')).toContainText('mainImage');
  await expect(editor.locator('.view-lines')).not.toBeInViewport();

  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(editor.locator('.view-lines')).toBeInViewport();
  await expect(editor.locator('.view-lines')).toContainText('mainImage');
});

test.describe('phone editor on iOS', () => {
  // WebKit is not available everywhere this suite runs, so Chromium stands in
  // with an iPhone user agent: Monaco picks its iOS touch handling from it.
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  // On macOS the browser clipboard is the system pasteboard, shared with every
  // parallel worker, so another spec can replace its text mid-test. Give each
  // page its own clipboard behind the same API the editor reads.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let text = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: async () => text,
          writeText: async (value) => {
            text = String(value);
          },
        },
      });
    });
  });

  async function openPhoneEditor(page) {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Workspace panels' });
    await nav.getByRole('button', { name: 'Studio' }).click();
    await page.getByTestId('shader-option-aurora-glsl').click();
    await nav.getByRole('button', { name: 'Editor' }).click();
    const editor = page.locator('[data-testid="file-editor"][data-path="/aurora.glsl"]');
    await expect(editor.locator('.view-lines')).toBeInViewport();
    return editor;
  }

  async function longPress(page, locator) {
    const box = await locator.boundingBox();
    const point = { x: box.x + 40, y: box.y + 10 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  test('focusing the editor uses a text field large enough that Safari does not zoom', async ({ page }) => {
    const editor = await openPhoneEditor(page);
    await editor.locator('.view-lines').tap();
    const input = editor.locator('textarea.inputarea');
    await expect(input).toBeFocused();
    // Safari zooms into any focused text field under 16px.
    expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test('a long press opens Cut, Copy and Paste, and Paste inserts the clipboard text', async ({ page }) => {
    const editor = await openPhoneEditor(page);
    await page.evaluate(() => navigator.clipboard.writeText('pasted_from_menu'));
    // A long press is often the first touch on the editor, so start unfocused.
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());

    await longPress(page, editor.locator('.view-line').first());

    const menu = page.locator('.monaco-menu');
    for (const name of ['Cut', 'Copy', 'Paste']) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
    }
    await menu.getByRole('menuitem', { name: 'Paste' }).click();
    await expect(editor.locator('.view-lines')).toContainText('pasted_from_menu');
  });
});

test('the phone shell has no header; Studio holds Workspace, Settings and the save status', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await expect(nav.getByRole('button')).toHaveText(['Studio', 'Editor', 'Preview', 'Tools']);
  await expect(page.locator('header.standalone-toolbar')).toBeHidden();
  const workspace = page.getByRole('button', { name: 'Workspace', exact: true });
  await expect(workspace).toBeHidden();
  await expect(page.getByTestId('web-alpha-warning')).toBeHidden();

  await nav.getByRole('button', { name: 'Studio' }).click();
  await expect(nav.getByRole('button', { name: 'Studio' })).toHaveAttribute('aria-current', 'page');
  await expect(workspace).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
  await expect(page.getByRole('status', { name: /saved|saving|session/i })).toBeInViewport();
  await expect(page.getByTestId('web-alpha-warning')).toBeInViewport();
  await expect(page.getByTestId('shader-option-aurora-glsl')).toBeInViewport();

  await workspace.click();
  await expect(page.getByRole('menu', { name: 'Workspace' }).getByRole('button', { name: 'Export Workspace Backup' })).toBeInViewport();
  await page.keyboard.press('Escape');

  await page.getByRole('navigation', { name: 'Studio sections' }).getByRole('button', { name: 'Files' }).click();
  await expect(workspace).toBeInViewport();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();
  await page.keyboard.press('Escape');

  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(workspace).toBeHidden();

  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('header.standalone-toolbar')).toBeVisible();
  await expect(page.locator('header.standalone-toolbar').getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
});

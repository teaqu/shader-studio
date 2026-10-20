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
  await expect(editor.locator('.cm-content, .view-lines').first()).toContainText('mainImage');

  await page.setViewportSize(phone);
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  // Dockview hides groups without emptying their boxes, so check what is on screen.
  await expect(editor.locator('.cm-content, .view-lines').first()).toBeInViewport();
  await expect(editor.locator('.cm-content, .view-lines').first()).toContainText('mainImage');

  await page.reload();
  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  await expect(editor.locator('.cm-content, .view-lines').first()).toBeInViewport();
});

test('refresh restores each phone destination, including Studio Files', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  for (const name of ['Studio', 'Editor', 'Tools', 'Preview']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await page.reload();
    await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.standalone-layout')).toHaveAttribute(
      'data-mobile-panel', name === 'Studio' ? 'explorer' : name.toLowerCase(),
    );
  }
  await nav.getByRole('button', { name: 'Studio' }).click();
  await page.getByRole('navigation', { name: 'Studio sections' }).getByRole('button', { name: 'Files' }).click();
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Studio' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Studio sections' }).getByRole('button', { name: 'Files' }))
    .toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('treeitem', { name: 'aurora.glsl', exact: true })).toBeInViewport();
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

test('opening a shader from the phone Studio switches to its editor', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Studio' }).click();
  await page.getByTestId('shader-option-nebula-texture-glsl').click();

  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  const editor = page.locator('[data-testid="file-editor"][data-path="/nebula-texture.glsl"]');
  await expect(editor.locator('.view-lines')).toBeInViewport();
  await expect(editor.locator('.view-lines')).toContainText('mainImage');
  // One panel at a time: the explorer is off screen, not beside the editor.
  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).not.toBeInViewport();

  await nav.getByRole('button', { name: 'Studio' }).click();
  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('shader-option-aurora-glsl').click();
  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-testid="file-editor"][data-path="/aurora.glsl"] .view-lines')).toBeInViewport();
});

test('the phone Editor keeps its open-file tabs while other destinations hide panel tabs', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  const tab = (name) => page.locator('.dv-tab').filter({ hasText: new RegExp(`^${name.replace('.', '\\.')}$`) });
  await nav.getByRole('button', { name: 'Studio' }).click();
  // The bottom navigation stands in for panel tabs outside the Editor.
  await expect(tab('nebula-texture.glsl')).not.toBeVisible();
  await page.getByTestId('shader-option-nebula-texture-glsl').click();

  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  await expect(tab('nebula-texture.glsl')).toBeInViewport();

  await nav.getByRole('button', { name: 'Studio' }).click();
  await page.getByRole('navigation', { name: 'Studio sections' }).getByRole('button', { name: 'Files' }).click();
  await page.getByRole('treeitem', { name: 'aurora.sha.json', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  await expect(tab('nebula-texture.glsl')).toBeInViewport();
  await expect(tab('aurora.sha.json')).toBeInViewport();
  await expect(page.locator('[data-testid="file-editor"][data-path="/aurora.sha.json"] .view-lines')).toBeInViewport();

  await tab('nebula-texture.glsl').click();
  await expect(page.locator('[data-testid="file-editor"][data-path="/nebula-texture.glsl"] .view-lines')).toBeInViewport();
  await expect(page.locator('[data-testid="file-editor"][data-path="/aurora.sha.json"] .view-lines')).not.toBeInViewport();

  await nav.getByRole('button', { name: 'Preview' }).click();
  await expect(tab('Preview')).not.toBeVisible();
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

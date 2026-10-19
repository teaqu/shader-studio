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

test('Explorer holds Shaders and Files, and reopens the section last used', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await expect(nav.getByRole('button')).toHaveText(['Explorer', 'Editor', 'Preview', 'Tools']);
  await nav.getByRole('button', { name: 'Explorer' }).click();
  const sections = page.getByRole('navigation', { name: 'Explorer sections' });
  await expect(sections.getByRole('button', { name: 'Shaders' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('shader-option-aurora-glsl')).toBeVisible();

  await sections.getByRole('button', { name: 'Files' }).click();
  await expect(page.getByRole('treeitem', { name: 'aurora.glsl', exact: true })).toBeInViewport();
  await expect(page.getByTestId('shader-option-aurora-glsl')).not.toBeInViewport();
  await expect(nav.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('button', { name: 'Preview' }).click();
  await expect(sections).toBeHidden();
  await nav.getByRole('button', { name: 'Explorer' }).click();
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

test('opening a shader from the phone Explorer stays on Explorer without revealing the editor', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace panels' });
  await nav.getByRole('button', { name: 'Explorer' }).click();
  await page.getByTestId('shader-option-aurora-glsl').click();
  await page.getByTestId('shader-option-nebula-texture-glsl').click();

  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toHaveAttribute('aria-pressed', 'true');
  await expect(nav.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('shader-option-nebula-texture-glsl')).toBeInViewport();
  // Dockview hides groups without emptying their boxes, so check what is on screen.
  const editor = page.locator('[data-testid="file-editor"][data-path="/nebula-texture.glsl"]');
  await expect(editor.locator('.view-lines')).toContainText('mainImage');
  await expect(editor.locator('.view-lines')).not.toBeInViewport();

  await nav.getByRole('button', { name: 'Editor' }).click();
  await expect(editor.locator('.view-lines')).toBeInViewport();
  await expect(editor.locator('.view-lines')).toContainText('mainImage');
});

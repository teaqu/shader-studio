import { test, expect } from '@playwright/test';

for (const { name, option, extension, vertexPattern } of [
  { name: 'GLSL', option: 'aurora-glsl', extension: 'glsl', vertexPattern: 'void mainVertex' },
  { name: 'Slang', option: 'aurora-slang-slang', extension: 'slang', vertexPattern: 'void mainVertex' },
  { name: 'WGSL', option: 'aurora-wgsl-wgsl', extension: 'wgsl', vertexPattern: 'ptr<function, vec3f>' },
]) {
  test(`opens a created ${name} vertex shader from the Config panel`, async ({ page }) => {
    await page.goto('/');
    await page.getByTestId(`shader-option-${option}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();

    const vertex = page.locator('.config-item').filter({
      has: page.getByRole('heading', { name: 'Vertex shader', exact: true }),
    });
    page.once('dialog', dialog => dialog.accept(dialog.defaultValue()));
    await vertex.getByRole('button', { name: 'Create', exact: true }).click();
    const vertexPath = await vertex.locator('input').inputValue();
    const absoluteVertexPath = vertexPath.startsWith('/') ? vertexPath : `/shaders/${vertexPath.replace(/^\.\//, '')}`;
    await expect(vertex.locator('input')).toHaveValue(new RegExp(`\\.vert\\.${extension}$`));

    await vertex.getByRole('heading', { name: 'Vertex shader', exact: true }).dblclick();
    await expect(page.locator(`[data-testid="file-editor"][data-path="${absoluteVertexPath}"] .monaco-editor`)).toBeVisible();
    await expect(page.locator(`[data-testid="file-editor"][data-path="${absoluteVertexPath}"] .view-lines`)).toContainText(vertexPattern);
    await expect(page.getByTestId('web-preview').locator('.canvas-container canvas').first()).toBeVisible();
  });
}

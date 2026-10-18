import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { addShaderFiles, readWorkspaceFiles } from './workspace-store.mjs';

test('renames a shader with its config and deletes folders without resurrecting open files', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Workspace file tree' });
  await tree.getByRole('treeitem', { name: 'aurora.sha.json', exact: true }).click();
  await expect(page.locator('[data-testid="file-editor"][data-path="/shaders/aurora.sha.json"]')).toBeVisible();
  await tree.getByRole('treeitem', { name: 'aurora.glsl', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename / Move…' }).click();
  await page.getByLabel('Rename or move path').fill('/projects/renamed.glsl');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'renamed.glsl', exact: true })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'renamed.sha.json', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="file-editor"][data-path="/shaders/aurora.sha.json"]')).toHaveCount(0);
  await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('mainImage');
  await tree.getByRole('treeitem', { name: 'projects', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'projects', exact: true })).toHaveCount(0);
  await tree.getByRole('treeitem', { name: 'shaders', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Create or upload a shader to start previewing.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No files yet. Upload files or create a new file.')).toBeVisible();
  expect((await readWorkspaceFiles(page)).filter(file => !file.path.startsWith('/.shader-studio/'))).toEqual([]);
});

test('file tree creates, opens, renames, downloads and deletes files with reload persistence', async ({ page }) => {
  await page.goto('/');
  const filesTab = page.getByRole('tab', { name: 'Files', exact: true });
  await expect(filesTab).toBeVisible();
  await filesTab.click();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await page.getByLabel('New file path', { exact: true }).fill('/projects/tree-test.txt');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Workspace file tree' });
  await expect(tree.getByRole('treeitem', { name: 'tree-test.txt', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="file-editor"][data-path="/projects/tree-test.txt"]')).toBeVisible();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Rename or move path').fill('/projects/renamed.txt');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'renamed.txt', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="file-editor"][data-path="/projects/tree-test.txt"]')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('renamed.txt');
  await page.reload();
  await expect(filesTab).toHaveAttribute('aria-selected', 'true');
  await tree.getByRole('treeitem', { name: 'renamed.txt', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'renamed.txt', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'renamed.txt', exact: true })).toHaveCount(0);
  await page.reload();
  expect((await readWorkspaceFiles(page)).some(file => file.path.startsWith('/projects/'))).toBe(false);
});

for (const type of ['texture', 'cubemap']) {
  test(`direct ${type} upload selects the asset, renders it and survives reload`, async ({ page }) => {
    await page.goto('/');
    await addShaderFiles(page, [
      ['picker.glsl', `void mainImage(out vec4 c, vec2 p) { c = texture(iChannel0, ${type === 'texture' ? 'p / iResolution.xy' : 'vec3(0.0, 0.0, 1.0)'}); }`],
      ['picker.sha.json', JSON.stringify({ version: '1.0', passes: { Image: { inputs: { iChannel0: { type, path: '' } } } } })],
    ]);
    await page.reload();
    await page.getByTestId('shader-option-picker-glsl').click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.getByRole('button', { name: 'Configure iChannel0', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^iChannel0/ });
    await dialog.getByRole('tab', { name: type === 'texture' ? 'Textures' : 'Cubemaps', exact: true }).click();
    await expect(dialog.getByTitle('Upload from device')).toBeVisible();
    const image = new PNG({ width: type === 'texture' ? 1 : 4, height: type === 'texture' ? 1 : 3 });
    for (let offset = 0; offset < image.data.length; offset += 4) {
 image.data.set([0, 255, 0, 255], offset);
}
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByTitle('Upload from device').click();
    const name = `uploaded-${type}.png`;
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: PNG.sync.write(image) });
    await expect.poll(async () => JSON.parse((await readWorkspaceFiles(page)).find(file => file.path === '/shaders/picker.sha.json').contents).passes.Image.inputs.iChannel0.path).toBe(name);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const green = async () => {
      const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
      await expect.poll(async () => {
        const pixels = PNG.sync.read(await canvas.screenshot());
        const offset = (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width / 2)) * 4;
        return [...pixels.data.subarray(offset, offset + 3)];
      }).toEqual([0, 255, 0]);
    };
    await green();
    await page.reload();
    await green();
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible();
    await page.getByRole('treeitem', { name, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Asset preview' }).getByRole('img')).toBeVisible();
  });
}

import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { addShaderFiles, putWorkspaceFiles, readWorkspaceFiles } from './workspace-store.mjs';
import { dropDeviceFiles } from './file-drop.mjs';
import { useSharedShaderEditor } from './explorer-preferences.mjs';

// These tests edit through the shared editor rather than per-file editors.
test.beforeEach(({ context }) => useSharedShaderEditor(context));

test('selects multiple files, downloads selections and folders as ZIPs, and moves and deletes selections', async ({ page }, testInfo) => {
  await page.goto('/');
  const at = Date.now();
  await putWorkspaceFiles(page, [
    { path: '/multi-one.txt', contents: 'one λ', createdAt: at, modifiedAt: at },
    { path: '/multi-two.txt', contents: 'two', createdAt: at, modifiedAt: at },
    { path: '/multi-assets/pixel.png', contents: 'data:image/png;base64,AID/', createdAt: at, modifiedAt: at },
  ]);
  await page.reload();
  const pane = page.getByTestId('web-files');
  // Keep source and destination visible together in the scrollable tree.
  await pane.getByLabel('Filter workspace files').fill('multi');
  const one = pane.getByTitle('/multi-one.txt', { exact: true });
  const two = pane.getByTitle('/multi-two.txt', { exact: true });
  await one.click();
  await two.click({ modifiers: ['ControlOrMeta'] });
  await expect(one).toHaveAttribute('aria-selected', 'true');
  await expect(two).toHaveAttribute('aria-selected', 'true');
  // Selection must remain visible on every row after focus moves to another row.
  await expect(one).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(two).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const downloadZip = async name => {
    const waiting = page.waitForEvent('download');
    await pane.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe(name);
    const path = testInfo.outputPath(name);
    await download.saveAs(path);
    return JSZip.loadAsync(await readFile(path));
  };
  const selectedZip = await downloadZip('files.zip');
  expect(await selectedZip.file('multi-one.txt').async('string')).toBe('one λ');
  expect(await selectedZip.file('multi-two.txt').async('string')).toBe('two');
  await pane.getByTitle('/multi-assets', { exact: true }).click();
  const folderZip = await downloadZip('multi-assets.zip');
  expect([...await folderZip.file('multi-assets/pixel.png').async('uint8array')]).toEqual([0, 128, 255]);
  await one.click();
  await two.click({ modifiers: ['ControlOrMeta'] });
  await expect(one).toHaveAttribute('aria-selected', 'true');
  await expect(two).toHaveAttribute('aria-selected', 'true');
  await one.dragTo(pane.getByTitle('/multi-assets', { exact: true }));
  await expect(pane.getByTitle('/multi-assets/multi-one.txt', { exact: true })).toBeVisible();
  await expect(pane.getByTitle('/multi-assets/multi-two.txt', { exact: true })).toBeVisible();
  await page.reload();
  await pane.getByTitle('/multi-assets/multi-one.txt', { exact: true }).click();
  await pane.getByTitle('/multi-assets/multi-two.txt', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await expect(pane.getByTitle('/multi-assets/multi-one.txt', { exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(pane.getByTitle('/multi-assets/multi-two.txt', { exact: true })).toHaveAttribute('aria-selected', 'true');
  page.once('dialog', dialog => dialog.accept());
  await pane.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(pane.getByTitle('/multi-assets/multi-one.txt', { exact: true })).toHaveCount(0);
  await expect(pane.getByTitle('/multi-assets/multi-two.txt', { exact: true })).toHaveCount(0);
  await expect(pane.getByTitle('/multi-assets/pixel.png', { exact: true })).toBeVisible();
  await page.reload();
  expect((await readWorkspaceFiles(page)).some(file => file.path.endsWith('/multi-one.txt') || file.path.endsWith('/multi-two.txt'))).toBe(false);
});

test('standalone Files pane accepts device drops and moves files and folders by dragging', async ({ page }) => {
  await page.goto('/');
  const pane = page.getByTestId('web-files');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('web-shader-explorer')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveCount(0);
  await pane.getByRole('button', { name: 'New folder', exact: true }).click();
  await pane.getByLabel('New folder path', { exact: true }).fill('/assets');
  await pane.getByRole('button', { name: 'Save', exact: true }).click();
  const folder = pane.getByRole('treeitem', { name: 'assets', exact: true });
  await dropDeviceFiles(page, folder, [
    { name: 'move.glsl', mimeType: 'text/plain', buffer: Buffer.from('void mainImage(out vec4 c, vec2 p) { c = vec4(0, 1, 0, 1); }') },
    { name: 'move.sha.json', mimeType: 'application/json', buffer: Buffer.from('{"version":"1.0","passes":{"Image":{"inputs":{}}}}') },
  ]);
  await pane.getByRole('button', { name: 'New folder', exact: true }).click();
  await pane.getByLabel('New folder path', { exact: true }).fill('/archive');
  await pane.getByRole('button', { name: 'Save', exact: true }).click();
  const source = pane.getByRole('treeitem', { name: 'move.glsl', exact: true });
  await expect(source).toBeVisible();
  await source.dragTo(pane.getByRole('treeitem', { name: 'archive', exact: true }));
  await expect.poll(async () => (await readWorkspaceFiles(page)).map(file => file.path)).toEqual(expect.arrayContaining(['/archive/move.glsl', '/archive/move.sha.json']));
  expect((await readWorkspaceFiles(page)).some(file => file.path === '/assets/move.glsl')).toBe(false);
  await folder.dragTo(pane.getByRole('treeitem', { name: 'archive', exact: true }));
  await expect(pane.getByTitle('/archive/assets', { exact: true })).toBeVisible();
  await page.reload();
  await expect(pane.getByTitle('/archive/assets', { exact: true })).toBeVisible();
  await expect(pane.getByTitle('/archive/move.glsl', { exact: true })).toBeVisible();
  // Files is independently controlled through the same View menu as the other panes.
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Files$/ }).click();
  await expect(pane).not.toBeVisible();
  await page.reload();
  await expect(pane).not.toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Files$/ }).click();
  await expect(pane).toBeVisible();
});

test('renames a shader with its config and deletes folders without resurrecting open files', async ({ page }) => {
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Workspace file tree' });
  await tree.getByRole('treeitem', { name: 'aurora.sha.json', exact: true }).click();
  await expect(page.locator('[data-testid="file-editor"][data-path="/aurora.sha.json"]')).toBeVisible();
  await tree.getByRole('treeitem', { name: 'aurora.glsl', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename / Move…' }).click();
  await page.getByLabel('Rename or move path').fill('/projects/renamed.glsl');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'renamed.glsl', exact: true })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'renamed.sha.json', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="file-editor"][data-path="/aurora.sha.json"]')).toHaveCount(0);
  await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('mainImage');
  await tree.getByRole('treeitem', { name: 'projects', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'projects', exact: true })).toHaveCount(0);
  while (await tree.getByRole('treeitem').count()) {
    const first = tree.getByRole('treeitem').first();
    const path = await first.getAttribute('data-path');
    await first.click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(tree.getByTitle(path, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText('Create or upload a shader to start previewing.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No files yet. Drop files here or create a new file.')).toBeVisible();
  expect((await readWorkspaceFiles(page)).filter(file => !file.path.startsWith('/.shader-studio/'))).toEqual([]);
});

test('file tree creates, opens, renames, downloads and deletes files with reload persistence', async ({ page }) => {
  await page.goto('/');
  const pane = page.getByTestId('web-files');
  await expect(pane).toBeVisible();
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
  await expect(pane).toBeVisible();
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

test('Files offers uploads while Workspace omits them, and the editor warning closes persistently', async ({ page }) => {
  await page.goto('/');
  const warning = page.getByTestId('web-alpha-warning');
  await expect(warning).not.toContainText('Standalone mode is in');
  await expect(warning).toContainText('Changes are saved only in this browser. Clearing browser data will delete them.');
  await expect(warning.getByRole('button', { name: 'Dismiss alpha notice' })).toHaveText('×');
  await warning.getByRole('button', { name: 'Dismiss alpha notice' }).click();
  await expect(warning).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Workspace', exact: true }).getByRole('button', { name: /Upload Files/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('web-files').getByRole('button', { name: 'Upload Files', exact: true }).click();
  await (await chooser).setFiles({ name: 'root.txt', mimeType: 'text/plain', buffer: Buffer.from('root upload') });
  await expect(page.getByTestId('web-files').getByTitle('/root.txt', { exact: true })).toBeVisible();
  await page.reload();
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId('web-files').getByTitle('/root.txt', { exact: true })).toBeVisible();
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
    await expect.poll(async () => JSON.parse((await readWorkspaceFiles(page)).find(file => file.path === '/picker.sha.json').contents).passes.Image.inputs.iChannel0.path).toBe(name);
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
      await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible();
    await page.getByRole('treeitem', { name, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Asset preview' }).getByRole('img')).toBeVisible();
  });
}

import { expect, test } from '@playwright/test';

async function seedWgslAuditFiles(page, entries) {
  await page.goto('/');
  await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
  await page.evaluate((filesToAdd) => new Promise((resolve, reject) => {
    const open = indexedDB.open('shader-studio-web', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const read = store.get('workspace');
      read.onsuccess = () => {
        const files = read.result ?? [];
        for (const [name, contents] of filesToAdd) {
          files.push({ path: `/shaders/${name}`, contents, createdAt: Date.now(), modifiedAt: Date.now() });
        }
        store.put(files, 'workspace');
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), entries);
  await page.reload();
}

test('inspects and edits WGSL vec3 storage through the standalone config UI', async ({ page }) => {
  await seedWgslAuditFiles(page, [
    ['inspector.wgsl', `fn mainImage(coord: vec2f) -> vec4f {
  let value = directions[0];
  return vec4f(value, 1.0);
}`],
    ['inspector.sha.json', JSON.stringify({
      version: '1.0',
      storage: { directions: { count: 2, elementType: 'vec3<f32>' } },
      passes: { Image: { inputs: {} } },
    })],
  ]);

  await page.getByTestId('shader-option-inspector-wgsl').click();
  const preview = page.getByTestId('web-preview');
  await preview.getByLabel('Toggle config panel').click();
  const config = page.locator('.config-panel');
  await expect(config).toBeVisible();
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await config.getByLabel('Inspect directions').click();
  const inspector = page.getByLabel('Inspect directions');
  await expect(inspector.getByLabel('Element 0 component 2')).toHaveValue('0');
  await inspector.getByLabel('Element 0 component 1').fill('0.75');
  await expect.poll(async () => (await inspector.getByLabel('Element 0 component 1').inputValue())).toBe('0.75');
  await inspector.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(inspector.getByLabel('Element 0 component 1')).toHaveValue('0.75');
});

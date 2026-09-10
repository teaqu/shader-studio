import { expect, test } from '@playwright/test';

async function seedWorkspace(page, entries) {
  await page.evaluate((entries) => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      store.get('workspace').onsuccess = event => {
        const files = event.target.result ?? [];
        for (const [name, contents] of entries) {
          files.push({ path: `/shaders/${name}`, contents, createdAt: Date.now(), modifiedAt: Date.now() });
        }
        store.put(files, 'workspace');
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), entries);
}

test('WGSL aliases offer vector swizzles and struct fields in the standalone Monaco host', async ({ page }) => {
  const basename = 'wgsl-alias-members';
  const shaderName = `${basename}.wgsl`;
  const source = `alias Tint = vec4f;
struct Light { color: vec3f, }
alias KeyLight = Light;
fn mainImage(coord: vec2f) -> vec4f {
  var tint: Tint;
  var key: KeyLight;
  tint.
  key.
  return vec4f(coord, 0.0, 1.0);
}`;
  await page.route('**/__wgsl_ls_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture setup</title>' }));
  await page.goto('/__wgsl_ls_fixture__');
  await seedWorkspace(page, [
    [shaderName, source],
    [`${basename}.sha.json`, JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-${basename}-wgsl`).click();
  const editor = page.getByTestId('web-editor');

  for (const [line, member] of [["tint.", "xyzw"], ["key.", "color"]]) {
    await editor.locator('.view-line').getByText(line, { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+Space');
    const suggestions = page.locator('.suggest-widget:visible');
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toContainText(member);
    await page.keyboard.press('Escape');
  }
});

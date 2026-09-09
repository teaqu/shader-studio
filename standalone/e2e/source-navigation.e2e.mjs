import { expect, test } from '@playwright/test';

// Slang rendering needs a WebGPU adapter in headless Chromium.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu'] } });

for (const language of ['glsl', 'slang']) {
  for (const source of ['common', 'vertex']) {
    test(`double-clicking ${language} ${source} keeps standalone responsive`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      // Seed before the app mounts so its workspace autosave cannot overwrite the fixture.
      await page.route('**/', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
      await page.goto('/');
      await page.evaluate(async (language) => {
        const files = [
          [`/shaders/aurora.${language}`, language === 'glsl'
            ? 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'
            : 'float4 mainImage(float2 coord) { return float4(1.0); }'],
          [`/shaders/shared.${language}`, '// shared functions'],
          [`/shaders/vertex.${language}`, language === 'glsl'
            ? 'void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) {}'
            : 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {}'],
          ['/shaders/aurora.sha.json', JSON.stringify({ version: '1.0', passes: {
            Image: { inputs: {}, vertex: `vertex.${language}` }, common: { path: `shared.${language}` },
          } })],
        ].map(([path, contents]) => ({ path, contents, createdAt: 1, modifiedAt: 1 }));
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('shader-studio-web', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('state');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('state', 'readwrite');
            tx.objectStore('state').put(files, 'workspace');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        });
      }, language);
      await page.unroute('**/');
      await page.reload();
      await expect(page.getByTestId('web-editor').locator('.monaco-editor')).toBeVisible();
      await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
      if (source === 'common') {
        await page.locator('[data-tab-name="Common"]').dblclick();
      } else {
        await page.getByRole('heading', { name: 'Vertex shader', exact: true }).dblclick();
      }
      const path = `/shaders/${source === 'common' ? 'shared' : 'vertex'}.${language}`;
      const editor = page.locator(`[data-testid="file-editor"][data-path="${path}"]`);
      await expect(editor.locator('.monaco-editor')).toBeVisible();
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reset workspace layout', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await editor.locator('.view-lines').click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.insertText('// navigation edit\n');
      await expect(page.getByTestId('web-preview').getByLabel('Toggle pause')).not.toHaveClass(/error/);
      await expect.poll(() => page.evaluate((path) => new Promise((resolve, reject) => {
        const request = indexedDB.open('shader-studio-web', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('state', 'readonly').objectStore('state').get('workspace');
          read.onsuccess = () => {
            db.close();
            resolve(read.result.find(file => file.path === path)?.contents ?? '');
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }), path)).toContain('navigation edit');
      await page.reload();
      await expect(editor.locator('.monaco-editor')).toBeVisible();
      await expect(editor.locator('.view-lines')).toContainText('navigation edit');
      await expect(page.getByTestId('web-editor').locator('.view-lines')).toContainText('mainImage');
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Reset workspace layout', exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  }
}

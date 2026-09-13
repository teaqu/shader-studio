import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
async function pasteSource(page, editor, source) {
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  // Exercise Monaco's paste handler. insertText treats multiline text as typing
  // and adds indentation/closing braces; this paste preserves the authored text.
  await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, source);
}

async function seedWgslAuditFiles(page, entries) {
  // Seed before boot so initialization cannot overwrite the fixture transaction.
  await page.route('**/__debug_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__debug_fixture__');
  await page.evaluate((filesToAdd) => new Promise((resolve, reject) => {
    const open = indexedDB.open('shader-studio-web', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('state');
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
      tx.oncomplete = () => {
        db.close(); resolve();
      };
      tx.onerror = () => {
        db.close(); reject(tx.error);
      };
    };
  }), entries);
  await page.goto('/');
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

for (const language of ['wgsl', 'slang']) {
  test(`${language} keyword-prefix assignment captures the updated value after edit and reload`, async ({ page }) => {
    const source = language === 'wgsl'
      ? 'fn mainImage(p: vec2f) -> vec4f {\n  var formula: f32 = 0.125;\n  formula = 0.375;\n  return vec4f(formula);\n}'
      : 'float4 mainImage(float2 p) {\n  float formula = 0.125;\n  formula = 0.375;\n  return float4(formula);\n}';
    await seedWgslAuditFiles(page, [[`assignment.${language}`, source]]);
    await page.getByTestId(`shader-option-assignment-${language}`).click();
    const editor = page.getByTestId('web-editor');
    const panel = page.locator('.debug-panel');
    async function selectAssignment(value) {
      if (!await panel.isVisible()) {
        await page.getByTestId('web-preview').getByLabel('Toggle debug mode').click();
      }
      if (await panel.locator('.variables-section').count() === 0) {
        await panel.getByLabel('Toggle variable inspector').click();
      }
      await editor.locator('.view-line').filter({ hasText: `formula = ${value};` }).click();
      await expect(panel.locator('.fn-name')).toHaveText('mainImage');
      await expect(panel.locator('.header-info:not(.fn-name):not(.fn-type)')).toContainText('L3');
      const row = panel.locator('.var-row').filter({ has: page.locator('.var-name', { hasText: /^formula$/ }) });
      await expect(row.locator('.var-value')).toHaveText(value);
      await expect(panel.getByLabel('Show capture errors')).toHaveCount(0);
    }
    await selectAssignment('0.375');
    await pasteSource(page, editor, source.replace('0.375', '0.625'));
    await selectAssignment('0.625');
    await page.reload();
    await selectAssignment('0.625');
  });
}

test('Slang compute replay refuses subgroup results and recovers after an edit', async ({ page }) => {
  const source = '[shader("compute")] [numthreads(1,1,1)] void update(uint3 id : SV_DispatchThreadID) {\n  float shade = WaveActiveSum(0.125);\n  writeOutput(id.xy, float4(shade,0,0,1));\n}';
  await seedWgslAuditFiles(page, [
    ['replay.slang', 'float4 mainImage(float2 p) { return sample2DLevel(result.texture,result.sampler,p / iResolution.xy,0); }'],
    ['replay.compute.slang', source],
    ['replay.sha.json', JSON.stringify({ version: '1', passes: {
      Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
      Compute: { type: 'compute', path: 'replay.compute.slang', entryPoint: 'update' },
    } })],
  ]);
  await page.getByTestId('shader-option-replay-slang').click();
  const preview = page.getByTestId('web-preview');
  // Wait for this compute-backed Image to render. The explorer selects a file
  // before its asynchronous compilation replaces the previous preview.
  await expect.poll(async () => {
    const url = await preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)').evaluate(canvas => canvas.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  }).toEqual([32, 0, 0]);
  await preview.getByLabel('Toggle debug mode').click();
  const panel = page.locator('.debug-panel');
  if (await panel.locator('.variables-section').count() === 0) {
    await panel.getByLabel('Toggle variable inspector').click();
  }
  await preview.getByLabel('Toggle lock', { exact: true }).click();
  await preview.getByLabel('Toggle config panel').click();
  await page.locator('.config-panel [data-tab-name="Compute"]').dblclick();
  await page.getByText('Debug', { exact: true }).click();
  const editor = page.locator('.monaco-editor').filter({ visible: true });
  await editor.locator('.view-line').filter({ hasText: 'float shade' }).click();
  await expect(panel.locator('.line-tooltip')).toContainText('Slang compute replay does not support subgroup operations');
  await panel.getByLabel('Show capture errors').hover();
  await expect(page.locator('.error-tooltip.visible')).toContainText('Slang compute replay does not support subgroup operations');
  await pasteSource(page, editor, source.replace('WaveActiveSum(0.125)', '0.625'));
  await editor.locator('.view-line').filter({ hasText: 'float shade' }).click();
  const row = panel.locator('.var-row').filter({ has: page.locator('.var-name', { hasText: /^shade$/ }) });
  await expect(row.locator('.var-value')).toHaveText('0.625');
  await expect(panel.getByLabel('Show capture errors')).toHaveCount(0);
});

for (const language of ['wgsl', 'slang', 'glsl']) {
  test(`${language} separate editor sends cursor ownership to the debug panel`, async ({ page }) => {
    const source = language === 'wgsl'
      ? 'fn mainImage(p: vec2f) -> vec4f {\n  let shade = 0.375;\n  return vec4f(shade);\n}'
      : language === 'slang' ? 'float4 mainImage(float2 p) {\n  float shade = 0.375;\n  return float4(shade);\n}'
        : 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  float shade = 0.375;\n  fragColor = vec4(shade,0,0,1);\n}';
    await seedWgslAuditFiles(page, [[`separate.${language}`, source]]);
    await page.getByTestId(`shader-option-separate-${language}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle debug mode').click();
    const panel = page.locator('.debug-panel');
    if (await panel.locator('.variables-section').count() === 0) {
      await panel.getByLabel('Toggle variable inspector').click();
    }
    await page.getByRole('button', { name: 'Open in separate editor', exact: true }).click();
    const editor = page.locator('.monaco-editor').filter({ visible: true });
    await editor.locator('.view-line').filter({ hasText: 'shade = 0.375' }).click();
    await expect(panel.locator('.line-tooltip-anchor > .header-info')).toHaveText('L2');
    await expect(panel.locator('.fn-name')).toHaveText('mainImage');
    const row = panel.locator('.var-row').filter({ has: page.locator('.var-name', { hasText: /^shade$/ }) });
    await expect(row.locator('.var-value')).toHaveText('0.375');
    await pasteSource(page, editor, source.replace('0.375', '0.625'));
    await editor.locator('.view-line').filter({ hasText: 'shade = 0.625' }).click();
    await expect(row.locator('.var-value')).toHaveText('0.625');
  });
}

test('WGSL unmatched brace reports an error and recovers without freezing', async ({ page }) => {
  const source = 'fn mainImage(p: vec2f) -> vec4f {\n  let shade = 0.375;\n  return vec4f(shade,0,0,1);\n}';
  await seedWgslAuditFiles(page, [['recovery.wgsl', source]]);
  await page.getByTestId('shader-option-recovery-wgsl').click();
  const preview = page.getByTestId('web-preview');
  await preview.getByLabel('Toggle debug mode').click();
  const editor = page.getByTestId('web-editor');
  await editor.locator('.view-line').last().click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText('}');
  await expect(preview.getByLabel('Toggle pause', { exact: true })).toHaveClass(/error/);
  await page.keyboard.press('Backspace');
  await expect(preview.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
  const panel = page.locator('.debug-panel');
  if (await panel.locator('.variables-section').count() === 0) {
    await panel.getByLabel('Toggle variable inspector').click();
  }
  await editor.locator('.view-line').filter({ hasText: 'let shade' }).click();
  const row = panel.locator('.var-row').filter({ has: page.locator('.var-name', { hasText: /^shade$/ }) });
  await expect(row.locator('.var-value')).toHaveText('0.375');
  await page.reload();
  await expect(preview.getByLabel('Toggle pause', { exact: true })).not.toHaveClass(/error/);
});

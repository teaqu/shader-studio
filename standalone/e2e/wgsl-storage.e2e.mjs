import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { addShaderFiles, readWorkspaceFiles } from './workspace-store.mjs';
async function waitForStoragePreview(page, expected) {
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect.poll(async () => {
    const url = await canvas.evaluate(item => item.toDataURL());
    const { data, width, height } = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...data.subarray(offset, offset + 3)];
  }).toEqual(expected);
}
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
  await addShaderFiles(page, entries);
  await page.goto('/');
}

test('inspects WGSL vec3 storage read-only through the standalone config UI', async ({ page }) => {
  await seedWgslAuditFiles(page, [
    ['inspector.wgsl', `fn mainImage(coord: vec2f) -> vec4f {
  let value = directions[0];
  return vec4f(value, 1.0);
}`],
    ['inspector.sha.json', JSON.stringify({
      version: '1.0',
      storage: { directions: { count: 2, elementType: 'vec3<f32>', initialData: Buffer.from(new Float32Array([0.25, 0.75, 0.5, 0, 0, 0, 0, 0]).buffer).toString('base64') } },
      passes: { Image: { inputs: {} } },
    })],
  ]);

  await page.getByTestId('shader-option-inspector-wgsl').click();
  await waitForStoragePreview(page, [64, 191, 128]);
  const preview = page.getByTestId('web-preview');
  await preview.getByLabel('Toggle config panel').click();
  const config = page.locator('.config-panel');
  await expect(config).toBeVisible();
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await config.getByRole('tab', { name: 'Inspect', exact: true }).click();
  const inspector = page.getByLabel('Inspect directions');
  await expect(inspector.getByLabel('Element 0 component 1')).toHaveText('0.75');
  await expect(inspector.getByLabel('Element 0 component 2')).toHaveText('0.5');
  await expect(inspector.locator('table input')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Capture snapshot', exact: true }).click();
  await expect(inspector.getByLabel('Element 0 component 1')).toHaveText('0.75');
  await page.reload();
  await page.getByTestId('shader-option-inspector-wgsl').click();
  if (!await config.isVisible()) {
await preview.getByLabel('Toggle config panel').click();
}
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await config.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await expect(inspector.getByLabel('Element 0 component 1')).toHaveText('0.75');
});

for (const theme of ['light', 'dark']) {
test(`storage workspace saves structured layout and lifecycle changes and uses consistent tabs and controls (${theme})`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('shader-studio-theme', value), theme);
  await seedWgslAuditFiles(page, [
    ['storage-design.wgsl', 'fn mainImage(p: vec2f) -> vec4f { return vec4f(0.5); }'],
    ['storage-design.compute.wgsl', '@compute @workgroup_size(1) fn seed() { counters[0] = 1u; }'],
    ['storage-design.sha.json', JSON.stringify({ version: '1', storage: { particles: { count: 32, elementType: 'float4' }, counters: { count: 4, elementType: 'u32' } }, passes: { Image: {}, Seed: { type: 'compute', path: 'storage-design.compute.wgsl', entryPoint: 'seed', dispatchOnce: true, dispatch: { x: 1, y: 1, z: 1 } } } })],
  ]);
  await page.getByTestId('shader-option-storage-design-wgsl').click();
  const preview = page.getByTestId('web-preview'), config = page.locator('.config-panel');
  await preview.getByLabel('Toggle config panel').click();
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await config.getByLabel('Data layout').selectOption('struct');
  await config.getByLabel('Element count').fill('64');
  await config.getByLabel('Between frames').selectOption('clear');
  await config.getByLabel('Reset on restart').uncheck();
  await config.getByRole('button', { name: 'Apply particles changes' }).click();
  await expect(config.getByRole('button', { name: 'Apply particles changes' })).toHaveCount(0);
  await page.reload();
  await page.getByTestId('shader-option-storage-design-wgsl').click();
  if (!await config.isVisible()) {
 await preview.getByLabel('Toggle config panel').click();
}
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await expect(config.getByLabel('Element count')).toHaveValue('64');
  await expect(config.getByLabel('Data layout')).toHaveValue('struct');
  await expect(config.getByLabel('Field 1 name')).toHaveValue('position');
  await expect(config.getByLabel('Field 2 name')).toHaveValue('velocity');
  await expect(config.getByLabel('Between frames')).toHaveValue('clear');
  await expect(config.getByLabel('Reset on restart')).not.toBeChecked();
  await config.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await expect(config.getByRole('option', { name: 'Before Seed', exact: true })).toHaveCount(0);
  await expect(config.getByRole('option', { name: 'After Seed', exact: true })).toHaveCount(0);
  await config.getByRole('tab', { name: 'Settings', exact: true }).click();
  const actionHeights = await config.locator('.storage-panel button:not([role="tab"]):not(nav button)').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().height)));
  expect(new Set(actionHeights)).toEqual(new Set([32]));
  const inputTheme = await config.getByLabel('Element count').evaluate(item => {
    const style = getComputedStyle(item);
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--vscode-input-background)';
    item.parentElement.append(probe);
    const expectedBackground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { background: style.backgroundColor, expectedBackground, radius: style.borderRadius, fontSize: style.fontSize };
  });
  expect(inputTheme.background).toBe(inputTheme.expectedBackground);
  expect(inputTheme.radius).toBe('4px');
  expect(inputTheme.fontSize).toBe('12px');
  const tabStyle = await config.getByRole('tab', { name: 'Settings', exact: true }).evaluate(item => ({ radius: getComputedStyle(item).borderRadius, top: getComputedStyle(item).borderTopWidth }));
  expect(tabStyle).toEqual({ radius: '0px', top: '0px' });
  const navRow = config.getByRole('button', { name: 'Select storage particles' });
  expect(await navRow.evaluate(item => item.scrollHeight <= item.clientHeight)).toBe(true);
  await config.screenshot({ path: `test-results/storage-settings-${theme}.png` });
  await page.setViewportSize({ width: 1000, height: 900 });
  expect(await config.locator('.storage-panel').evaluate(item => item.scrollWidth <= item.clientWidth)).toBe(true);
});

}

test('storage inspector focuses one struct field and captures scalar values before and after compute', async ({ page }) => {
  await seedWgslAuditFiles(page, [
    ['storage-inspect.wgsl', 'fn mainImage(p: vec2f) -> vec4f { return particles[0].position; }'],
    ['storage-inspect.compute.wgsl', '@compute @workgroup_size(1) fn update() { counters[0] = 42u; }'],
    ['storage-inspect.sha.json', JSON.stringify({ version: '1', storage: {
      particles: { count: 2, elementType: 'ParticleData', fields: [{ name: 'position', type: 'float4' }, { name: 'velocity', type: 'float4' }], initialData: Buffer.from(new Float32Array([0.25, 0.5, 0.75, 1, 10, 20, 30, 40]).buffer).toString('base64') },
      counters: { count: 4, elementType: 'u32', clearEachFrame: true },
    }, passes: { Image: {}, Simulate: { type: 'compute', path: 'storage-inspect.compute.wgsl', entryPoint: 'update', dispatch: { x: 1, y: 1, z: 1 } } } })],
  ]);
  await page.getByTestId('shader-option-storage-inspect-wgsl').click();
  await waitForStoragePreview(page, [64, 128, 191]);
  const config = page.locator('.config-panel');
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await config.getByRole('tab', { name: 'Inspect', exact: true }).click();
  await expect(config.getByLabel('Element 0 component 0')).toHaveText('0.25');
  await config.getByLabel('Inspect field').selectOption('velocity');
  await expect(config.getByLabel('Element 0 component 0')).toHaveText('10');
  await expect(config.getByRole('columnheader')).toHaveCount(5);
  await config.getByRole('button', { name: 'Select storage counters' }).click();
  await expect(config.locator('table')).toHaveCount(0);
  await expect(config.getByLabel('Inspect field')).toHaveCount(0);
  await expect(config.getByLabel('Element 0 value')).toHaveText('42');
  await config.getByLabel('Capture point').selectOption(JSON.stringify({ pass: 'Simulate', timing: 'before' }));
  await expect(config.getByLabel('Element 0 value')).toHaveText('0');
  await expect(config.locator('.capture-meta')).toContainText('Before Simulate');
  await config.getByLabel('Capture point').selectOption(JSON.stringify({ pass: 'Simulate', timing: 'after' }));
  await expect(config.getByLabel('Element 0 value')).toHaveText('42');
  await config.getByLabel('Number display').selectOption({ label: 'Hex � integers' });
  await expect(config.getByLabel('Element 0 value')).toHaveText('0x0000002a');
  await config.getByRole('button', { name: 'Start live' }).click();
  await expect(config.getByRole('button', { name: 'Pause live' })).toHaveAttribute('aria-pressed', 'true');
  await config.getByRole('button', { name: 'Pause live' }).click();
  await config.getByRole('button', { name: 'Select storage particles' }).click();
  await expect(config.getByLabel('Inspect field')).toHaveValue('velocity');
  await expect(config.getByLabel('Element 0 component 0')).toHaveText('10');
  await config.screenshot({ path: 'test-results/storage-inspect.png' });
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

async function uploadStorageBinary(page) {
  await seedWgslAuditFiles(page, [
    ['binary-upload.wgsl', 'fn mainImage(p: vec2f) -> vec4f { return values[0]; }'],
    ['binary-upload.sha.json', JSON.stringify({ version: '1', storage: { values: { count: 2, elementType: 'float4' } }, passes: { Image: {} } })],
  ]);
  await page.getByTestId('shader-option-binary-upload-wgsl').click();
  const preview = page.getByTestId('web-preview'), config = page.locator('.config-panel');
  await preview.getByLabel('Toggle config panel').click();
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await expect(config.getByRole('button', { name: 'Apply pending storage changes' })).toHaveCount(0);
  await config.getByLabel('Initial data', { exact: true }).selectOption('file');
  await config.getByLabel('Initial data file', { exact: true }).setInputFiles({
    name: 'values.bin', mimeType: 'application/octet-stream',
    buffer: Buffer.from(new Float32Array([0.25, 0.75, 0.5, 1, 0.125, 0.25, 0.5, 1]).buffer),
  });
  await expect(config.getByText(/values\.bin/)).toBeVisible();
  await config.getByRole('button', { name: 'Apply pending storage changes' }).click();
  await expect(config.getByRole('button', { name: 'Apply pending storage changes' })).toHaveCount(0);
  await page.reload();
  await page.getByTestId('shader-option-binary-upload-wgsl').click();
  if (!await config.isVisible()) {
 await preview.getByLabel('Toggle config panel').click();
}
  await config.getByRole('button', { name: 'Storage', exact: true }).click();
  await expect(config.getByLabel('Initial data', { exact: true })).toHaveValue('file');
  await expect(config.getByText(/values\.bin/)).toBeVisible();
  return config;
}

test('binary upload applies from the header and persists its exact bytes after reload', async ({ page }) => {
  await uploadStorageBinary(page);
  const saved = await readWorkspaceFiles(page);
  const configFile = saved.find(file => file.path === '/shaders/binary-upload.sha.json');
  const storage = JSON.parse(configFile.contents).storage.values;
  expect(storage.initialDataName).toBe('values.bin');
  expect(Buffer.from(storage.initialData, 'base64')).toEqual(Buffer.from(new Float32Array([0.25, 0.75, 0.5, 1, 0.125, 0.25, 0.5, 1]).buffer));
});

test('binary upload initializes real GPU storage and inspection after reload', async ({ page }) => {
  const config = await uploadStorageBinary(page);
  await waitForStoragePreview(page, [64, 191, 128]);
  await config.getByRole('tab', { name: 'Inspect', exact: true }).click();
  const inspector = page.getByLabel('Inspect values', { exact: true });
  for (const [row, values] of [[0, ['0.25', '0.75', '0.5', '1']], [1, ['0.125', '0.25', '0.5', '1']]]) {
    for (const [component, value] of values.entries()) {
      await expect(inspector.getByLabel(`Element ${row} component ${component}`, { exact: true })).toHaveText(value);
    }
  }
});

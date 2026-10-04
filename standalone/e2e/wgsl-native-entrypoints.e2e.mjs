import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

async function openFixture(page, stem, source, config = { version: '1.0', passes: { Image: { inputs: {} } } }) {
  await page.route('**/__native_entrypoint_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
  await page.goto('/__native_entrypoint_fixture__');
  await workspace(page, [
    [`${stem}.wgsl`, source],
    [`${stem}.sha.json`, JSON.stringify(config)],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-${stem}-wgsl`).click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
}

async function pasteSource(page, editor, source) {
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.evaluate(text => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, source);
}

async function centerPixel(canvas) {
  return canvas.evaluate(async element => {
    const blob = await (await fetch(element.toDataURL())).blob();
    const bitmap = await createImageBitmap(blob);
    const sample = new OffscreenCanvas(1, 1);
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
}

function isRedOnly([red, green, blue, alpha]) {
  return red > 100 && red < 155 && green < 5 && blue < 5 && alpha === 255;
}

function isGray([red, green, blue, alpha]) {
  return red > 100 && red < 155 && Math.abs(red - green) < 3 && Math.abs(green - blue) < 3 && alpha === 255;
}

test('WGSL native Insert appends one buffer and one compute entry point, then persists their config', async ({ page }) => {
  const stem = 'native-insert';
  const source = [
    '@vertex fn imageVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {',
    '  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));',
    '  return vec4f(points[index], 0.0, 1.0);',
    '}',
    '@fragment fn imageFragment() -> @location(0) vec4f { return vec4f(0.1, 0.2, 0.3, 1.0); }',
    '',
  ].join('\n');
  await openFixture(page, stem, source, {
    version: '1.0', webgpu: { defaultRenderAuthoring: 'native' }, passes: { Image: { inputs: {} } },
  });

  // The saved project preference governs the single Buffer action.
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Buffer' }).click();
  const buffer = page.locator('.tab-content').filter({ has: page.getByLabel('Render entry points') });
  await expect(buffer.getByLabel('Vertex function')).toHaveValue('');
  await buffer.getByRole('button', { name: 'Add output' }).click();
  await expect(buffer.getByLabel('Output 1 name')).toBeVisible();
  await buffer.locator('.config-item').first().getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(buffer.getByLabel('Vertex function')).toHaveValue('BufferAVertex');
  await expect(buffer.getByLabel('Fragment function')).toHaveValue('BufferAFragment');

  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Compute' }).click();
  // A newly added compute pass has no selected entry point yet, so its
  // selector is not rendered until Insert returns one.
  await page.getByRole('button', { name: 'Insert', exact: true }).click();

  await expect.poll(async () => {
    const files = await workspace(page);
    const config = JSON.parse(files[`/shaders/${stem}.sha.json`]);
    const bufferPass = config.passes.BufferA;
    const computePass = config.passes.ComputeA;
    return {
      config,
      source: files[`/shaders/${stem}.wgsl`],
      bufferPass,
      computePass,
    };
  }).toMatchObject({
    config: { webgpu: { defaultRenderAuthoring: 'native' } },
    bufferPass: { entryPoints: { vertex: 'BufferAVertex', fragment: 'BufferAFragment' }, outputs: [{}, {}] },
    computePass: { type: 'compute', entryPoints: { compute: 'ComputeACompute' } },
  });

  const saved = await workspace(page);
  expect(saved[`/shaders/${stem}.wgsl`].match(/@vertex\s+fn BufferAVertex/g)).toHaveLength(1);
  expect(saved[`/shaders/${stem}.wgsl`].match(/@compute @workgroup_size/g)).toHaveLength(1);
  expect(saved[`/shaders/${stem}.wgsl`]).toContain('@location(1)');

  await page.reload();
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes).toMatchObject({
    BufferA: { entryPoints: { vertex: 'BufferAVertex', fragment: 'BufferAFragment' } },
    ComputeA: { entryPoints: { compute: 'ComputeACompute' } },
  });
});

test('WGSL native render selector saves a deliberate fragment choice and hook creation remains compatible', async ({ page }) => {
  const stem = 'native-selection';
  const source = [
    '@vertex fn vertexA(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f { return vec4f(f32(index)); }',
    '@fragment fn fragmentA() -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }',
    '@fragment fn fragmentB() -> @location(0) vec4f { return vec4f(0.0, 1.0, 0.0, 1.0); }',
    '',
  ].join('\n');
  await openFixture(page, stem, source);

  await page.getByLabel('Vertex function').selectOption('vertexA');
  await expect(page.getByLabel('Vertex function')).toHaveValue('vertexA');
  await page.getByLabel('Fragment function').selectOption('fragmentB');
  await page.getByLabel('Vertex function').selectOption('');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Buffer' }).click();

  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`])).toMatchObject({
    passes: { Image: { inputs: {} }, BufferA: { inputs: {} } },
  });
  const config = JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]);
  expect(config.passes.Image.entryPoints).toEqual({ fragment: 'fragmentB' });
  expect(config.passes.BufferA.entryPoints).toBeUndefined();

  // Restore just the vertex selection. This proves mixed hook/native stages
  // persist without a single-candidate fallback.
  await page.locator('[data-tab-name="Image"]').click();
  await page.getByLabel('Vertex function').selectOption('vertexA');
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.entryPoints).toEqual({ vertex: 'vertexA', fragment: 'fragmentB' });
  await page.reload();
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.entryPoints).toEqual({ vertex: 'vertexA', fragment: 'fragmentB' });
});

test('a shared Buffer keeps its selected second fragment after rapid source updates', async ({ page }) => {
  const stem = 'native-shared-fragment-refresh';
  const vertex = [
    '@vertex fn rasterVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {',
    '  let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));',
    '  return vec4f(points[index], 0.0, 1.0);',
    '}',
  ].join('\n');
  const rasterColor = '@fragment fn rasterColor() -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }';
  const rasterColor2 = '@fragment fn rasterColor2() -> @location(0) vec4f { return vec4f(0.0, 1.0, 0.0, 1.0); }';
  const source = [vertex, rasterColor, rasterColor2].join('\n');
  await openFixture(page, stem, source, {
    version: '1.0', passes: {
      Image: { entryPoints: { vertex: 'rasterVertex', fragment: 'rasterColor2' } },
      BufferA: { path: `${stem}.wgsl`, entryPoints: { vertex: 'rasterVertex', fragment: 'rasterColor2' } },
    },
  });

  const editor = page.getByTestId('web-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await page.locator('[data-tab-name="BufferA"]').click();
  const fragment = page.getByLabel('Fragment function');
  await expect(fragment).toHaveValue('rasterColor2');

  // These are whole-source Monaco pastes. The final source is complete again;
  // no stale per-pass source snapshot may leave the selected function missing.
  await pasteSource(page, editor, [vertex, rasterColor].join('\n'));
  await pasteSource(page, editor, [vertex, rasterColor, '@fragment fn rasterColor3() -> @location(0) vec4f { return vec4f(0.0, 0.0, 1.0, 1.0); }'].join('\n'));
  await pasteSource(page, editor, source);

  await expect.poll(async () => Array.from(await fragment.locator('option').allTextContents())).toContain('@fragment rasterColor2');
  await expect.poll(async () => Array.from(await fragment.locator('option').allTextContents())).not.toContain('rasterColor2 (missing)');
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.BufferA.entryPoints).toEqual({ vertex: 'rasterVertex', fragment: 'rasterColor2' });
  await page.reload();
  await page.locator('[data-tab-name="BufferA"]').click();
  await expect(page.getByLabel('Fragment function')).toHaveValue('rasterColor2');
});

test('a separate native MRT Buffer routes cursor ownership and previews selected outputs', async ({ page }) => {
  const stem = 'native-mrt-debug';
  const fields = Array.from({ length: 6 }, (_, i) => `@location(${i}) output${i}: vec4f,`).join('');
  const values = Array.from({ length: 6 }, (_, i) => `vec4f(value.x,${i}.0/5.0,0,1)`).join(',');
  const buffer = `@vertex fn bufferVertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1); }
struct Outputs {${fields}}
@fragment fn bufferFragment(@builtin(position) position:vec4f)->Outputs {
  let value: vec4f = vec4f(position.x/512.0);
  return Outputs(${values});
}`;
  await page.route('**/__native_mrt_debug_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto('/__native_mrt_debug_fixture__');
  await workspace(page, [
    [`${stem}.wgsl`, 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.5,0,0,1); }'],
    [`${stem}/buffer.wgsl`, buffer],
    [`${stem}.sha.json`, JSON.stringify({ version:'1.0', passes:{ Image:{inputs:{}}, BufferA:{path:`${stem}/buffer.wgsl`,entryPoints:{vertex:'bufferVertex',fragment:'bufferFragment'},outputs:[{name:'colour'},{name:'normal'},{},{},{},{name:'depth'}]} } })],
  ]);
  await page.goto('/');
  const preview = page.getByTestId('web-preview');
  const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect.poll(async () => isRedOnly(await centerPixel(canvas))).toBe(true);
  await preview.getByLabel('Toggle config panel').click();
  await page.locator('[data-tab-name="BufferA"]').dblclick();
  const editor = page.locator(`[data-testid="file-editor"][data-path="/shaders/${stem}/buffer.wgsl"]`);
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await preview.getByLabel('Toggle debug mode').click();
  const panel = page.locator('.debug-panel');
  if (await panel.locator('.variables-section').count() === 0) {
    await panel.getByLabel('Toggle variable inspector').click();
  }
  // The pane opens at line 1. Move through Monaco itself so the host receives
  // the selected Buffer statement rather than a synthetic cursor message.
  const editorInput = editor.locator('textarea');
  await editorInput.press('ArrowDown');
  await editorInput.press('ArrowDown');
  await editorInput.press('ArrowDown');
  const output = panel.getByLabel('Preview output');
  await expect(output).toHaveValue('0');
  // Turn off local inline rendering to display the selected native attachment
  // itself; the selected statement would otherwise replace it with `value`.
  await panel.getByLabel('Toggle inline rendering').click();
  await output.selectOption('1');
  await expect(output).toHaveValue('1');
  // The raw attachment's linear 0.2 green channel reads back around 51.
  await expect.poll(async () => (await centerPixel(canvas))[1]).toBeGreaterThan(45);
  await expect.poll(async () => (await centerPixel(canvas))[1]).toBeLessThan(60);
  await output.selectOption('5');
  await expect(output).toHaveValue('5');
  await expect.poll(async () => (await centerPixel(canvas))[1]).toBeGreaterThan(245);
  await panel.getByLabel('Toggle inline rendering').click();
  await panel.getByLabel('Cycle normalize mode').click();
  await panel.getByLabel('Toggle step threshold').click();
  await expect(panel.getByLabel('Cycle normalize mode')).toHaveAttribute('data-tooltip', /Normalize: SOFT/);
  await expect(panel.getByLabel('Toggle step threshold')).toHaveAttribute('data-tooltip', /Step: ON/);
  const valueRow = panel.locator('.var-row').filter({has: page.locator('.var-name',{hasText:/^value$/})});
  await expect(valueRow).toBeVisible();
  await expect(valueRow.locator('.var-value')).toContainText(/[0-9]/);
  await expect(valueRow.locator('.var-value')).not.toContainText(/NaN|Infinity/);
  await preview.getByLabel('Toggle debug mode').click();
  await expect.poll(async () => isRedOnly(await centerPixel(canvas))).toBe(true);
});

test('new native WGSL Image compiles and makes native Buffer the default', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  await explorer.getByTitle('New Shader').click();
  const dialog = page.getByRole('dialog', { name: 'New Shader' });
  await dialog.getByLabel('Shader name').fill('native-image-created');
  await dialog.getByLabel('Shader language').selectOption('wgsl');
  await dialog.getByLabel('Shader functions').selectOption('native');
  await dialog.getByRole('button', { name: 'Create Shader', exact: true }).click();

  const shader = page.getByTestId('shader-option-native-image-created-wgsl');
  await expect(shader).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('web-preview').locator('.canvas-container canvas').first()).toBeVisible();
  await expect(shader.locator('.shader-error')).toHaveCount(0);
  await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/native-image-created.sha.json'])).toMatchObject({
    webgpu: { defaultRenderAuthoring: 'native' },
    passes: { Image: { entryPoints: { vertex: 'ImageVertex', fragment: 'ImageFragment' } } },
  });

  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Buffer' }).click();
  await expect(page.getByLabel('Vertex function')).toHaveValue('');
  await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/native-image-created.sha.json']).passes.BufferA).toMatchObject({ entryPoints: {} });
});

test('new native Slang Image compiles, then inserts Buffer and Compute into the same source with canonical entries', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  await explorer.getByTitle('New Shader').click();
  const dialog = page.getByRole('dialog', { name: 'New Shader' });
  await dialog.getByLabel('Shader name').fill('native-slang-created');
  await dialog.getByLabel('Shader language').selectOption('slang');
  await dialog.getByLabel('Shader functions').selectOption('native');
  await dialog.getByRole('button', { name: 'Create Shader', exact: true }).click();

  const shader = page.getByTestId('shader-option-native-slang-created-slang');
  await expect(shader).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('web-preview').locator('.canvas-container canvas').first()).toBeVisible();
  await expect(shader.locator('.shader-error')).toHaveCount(0);
  await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/native-slang-created.sha.json'])).toMatchObject({
    webgpu: { defaultRenderAuthoring: 'native' },
    passes: { Image: { entryPoints: { vertex: 'ImageVertex', fragment: 'ImageFragment' } } },
  });

  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Buffer' }).click();
  await expect(page.getByLabel('Vertex function')).toHaveValue('');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.getByLabel('Vertex function')).toHaveValue('BufferAVertex');
  await expect(page.getByLabel('Fragment function')).toHaveValue('BufferAFragment');

  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Compute' }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();

  await expect.poll(async () => {
    const files = await workspace(page);
    return {
      source: files['/shaders/native-slang-created.slang'],
      config: JSON.parse(files['/shaders/native-slang-created.sha.json']),
    };
  }).toMatchObject({
    source: expect.stringContaining('[shader("compute")]'),
    config: {
      webgpu: { defaultRenderAuthoring: 'native' },
      passes: {
        Image: { entryPoints: { vertex: 'ImageVertex', fragment: 'ImageFragment' } },
        BufferA: { entryPoints: { vertex: 'BufferAVertex', fragment: 'BufferAFragment' } },
        ComputeA: { type: 'compute', entryPoints: { compute: 'ComputeACompute' } },
      },
    },
  });

  await page.reload();
  await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/native-slang-created.sha.json']).passes).toMatchObject({
    BufferA: { entryPoints: { vertex: 'BufferAVertex', fragment: 'BufferAFragment' } },
    ComputeA: { entryPoints: { compute: 'ComputeACompute' } },
  });
});

test('native Compute Insert follows the active separate Buffer editor source and persists that source path', async ({ page }) => {
  const stem = 'native-current-buffer';
  const image = 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1, 0, 0, 1); }';
  const buffer = `@vertex fn BufferAVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1), vec2f(3,-1), vec2f(-1,3)); return vec4f(p[i],0,1);
}
@fragment fn BufferAFragment() -> @location(0) vec4f { return vec4f(0,1,0,1); }`;
  await page.route('**/__native_current_buffer_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
  await page.goto('/__native_current_buffer_fixture__');
  await workspace(page, [
    [`${stem}.wgsl`, image],
    [`${stem}/buffer.wgsl`, buffer],
    [`${stem}.sha.json`, JSON.stringify({
      version: '1.0', webgpu: { defaultRenderAuthoring: 'native' },
      passes: {
        Image: { inputs: {} },
        BufferA: { path: `${stem}/buffer.wgsl`, entryPoints: { vertex: 'BufferAVertex', fragment: 'BufferAFragment' } },
      },
    })],
  ]);
  await page.goto('/');
  // Workspace hydration opens the newly supplied root shader directly.
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
  await page.locator('[data-tab-name="BufferA"]').dblclick();
  await expect(page.locator(`[data-testid="file-editor"][data-path="/shaders/${stem}/buffer.wgsl"]`).locator('.monaco-editor')).toBeVisible();

  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Compute' }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();

  await expect.poll(async () => {
    const files = await workspace(page);
    return {
      image: files[`/shaders/${stem}.wgsl`],
      buffer: files[`/shaders/${stem}/buffer.wgsl`],
      compute: JSON.parse(files[`/shaders/${stem}.sha.json`]).passes.ComputeA,
    };
  }).toMatchObject({
    image,
    buffer: expect.stringContaining('@compute @workgroup_size'),
    compute: { path: `/shaders/${stem}/buffer.wgsl`, type: 'compute', entryPoints: { compute: 'ComputeACompute' } },
  });

  await page.reload();
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.ComputeA).toMatchObject({
    path: `/shaders/${stem}/buffer.wgsl`, entryPoints: { compute: 'ComputeACompute' },
  });
});

for (const language of ['wgsl', 'slang']) {
  test(`native ${language} varying capture preserves the selected raster interface and restores output`, async ({ page }) => {
    const stem = `native-varying-debug-${language}`;
    const source = language === 'wgsl'
      ? `struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertices(@builtin(vertex_index) i: u32) -> Varyings {
  let p = array(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
  return Varyings(vec4f(p[i],0.0,1.0), p[i] * 0.5 + 0.5);
}
@fragment fn image(input: Varyings) -> @location(0) vec4f {
  let value = input.uv.x;
  return vec4f(value, 0.0, 0.0, 1.0);
}`
      : `struct Varyings { float4 position : SV_Position; float2 uv : TEXCOORD0; };
[shader("vertex")] Varyings vertices(uint i : SV_VertexID) {
  float2 p[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)};
  Varyings output; output.position = float4(p[i],0,1); output.uv = p[i] * 0.5 + 0.5; return output;
}
[shader("fragment")] float4 image(Varyings input) : SV_Target0 {
  float value = input.uv.x;
  return float4(value, 0, 0, 1);
}`;
    await page.route('**/__native_varying_debug_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
    await page.goto('/__native_varying_debug_fixture__');
    await workspace(page, [
      [`${stem}.${language}`, source],
      [`${stem}.sha.json`, JSON.stringify({ version: '1.0', passes: { Image: { entryPoints: { vertex: 'vertices', fragment: 'image' } } } })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${stem}-${language}`).click();
    const preview = page.getByTestId('web-preview');
    const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => isRedOnly(await centerPixel(canvas))).toBe(true);
    const editor = page.getByTestId('web-editor');

    await preview.getByLabel('Toggle debug mode').click();
    const panel = page.locator('.debug-panel');
    if (await panel.locator('.variables-section').count() === 0) {
      await panel.getByLabel('Toggle variable inspector').click();
    }
    if (language === 'wgsl') {
      await editor.locator('.view-line').filter({ hasText: 'let value =' }).click();
    } else {
      const valueLine = editor.locator('.view-line').filter({ hasText: 'float value =' });
      await valueLine.scrollIntoViewIfNeeded();
      await valueLine.click({ position: { x: 120, y: 10 } });
    }
    // The authored shader is red-only; an inline scalar preview is grayscale.
    // This proves the selected native fragment was instrumented before capture.
    await expect.poll(async () => isGray(await centerPixel(canvas))).toBe(true);
    const value = panel.locator('.var-row').filter({ has: page.locator('.var-name', { hasText: /^value$/ }) });
    await expect(value).toBeVisible();
    await expect(value).toContainText('min');
    await expect(value).toContainText('max');
    await expect(panel.locator('.issue-button')).toHaveCount(0);

    await preview.getByLabel('Toggle debug mode').click();
    await expect.poll(async () => isRedOnly(await centerPixel(canvas))).toBe(true);
  });
}


test('the viewer camera checkbox disables orbit and survives reload', async ({ page }) => {
  const stem = 'viewer-camera-choice';
  await openFixture(page, stem, `fn mainVertex(p: ptr<function, vec3f>, n: ptr<function, vec3f>, uv: ptr<function, vec2f>) { *p *= 0.65; }
fn mainImage(coord: vec2f) -> vec4f { return vec4f(abs(iWorldPosition) * 0.65 + vec3f(0.08,0.03,0.12),1); }`,
    { version: '1.0', passes: { Image: { geometry: { type: 'cube' } } } });
  const preview = page.getByTestId('web-preview');
  const checkbox = page.getByRole('checkbox', { name: 'Use viewer camera' });
  const canvas = preview.locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  await expect(checkbox).toBeChecked();
  await expect.poll(async () => (await centerPixel(canvas)).slice(0,3).reduce((sum,value) => sum+value,0)).toBeGreaterThan(10);
  const read = () => canvas.evaluate(element => element.toDataURL());
  const initial = await read();
  await checkbox.uncheck();
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.useViewerCamera).toBe(false);
  await expect.poll(read).not.toBe(initial);
  const orbit = async () => {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
  };
  const disabled = await read();
  await orbit();
  await expect.poll(read).toBe(disabled);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect.poll(async () => (await centerPixel(canvas)).slice(0,3).reduce((sum,value) => sum+value,0)).toBeGreaterThan(10);
  const reloaded = await read();
  await orbit();
  await expect.poll(read).toBe(reloaded);
  await checkbox.check();
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.useViewerCamera).toBe(true);
  await expect.poll(read).not.toBe(reloaded);
  const enabled = await read();
  await orbit();
  await expect.poll(read).not.toBe(enabled);
});


test('viewer camera inherits global settings, supports per-pass overrides, and survives reload', async ({ page }) => {
  const stem = 'camera-defaults';
  const source = `fn mainVertex(p: ptr<function, vec3f>, n: ptr<function, vec3f>, uv: ptr<function, vec2f>) { *p *= 0.65; }
fn mainImage(coord: vec2f) -> vec4f { return vec4f(abs(iWorldPosition) * 0.65 + vec3f(0.08,0.03,0.12),1); }`;
  const config = { version: '1.0', passes: { Image: { geometry: { type: 'cube' } } } };
  await openFixture(page, stem, source, config);
  await workspace(page, [['camera-other.wgsl', source], ['camera-other.sha.json', JSON.stringify(config)]]);
  await expect(page.getByText('Viewer camera defaults', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Use viewer camera globally', exact: true })).toHaveCount(0);
  const changeGlobal = async (enabled) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('checkbox', { name: 'Use viewer camera', exact: true }).setChecked(enabled);
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
  };
  const pass = page.getByRole('checkbox', { name: 'Use viewer camera', exact: true });
  await expect(page.getByLabel('Shader viewer camera')).toHaveCount(0);
  const canvas = page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
  const read = () => canvas.evaluate(element => element.toDataURL());
  await expect(pass).toBeChecked();
  await expect.poll(async () => (await centerPixel(canvas)).slice(0,3).reduce((sum,value) => sum+value,0)).toBeGreaterThan(10);
  const enabled = await read();
  await changeGlobal(false);
  await expect(pass).not.toBeChecked();
  await expect.poll(read).not.toBe(enabled);
  const saved = () => workspace(page).then(files => JSON.parse(files[`/shaders/${stem}.sha.json`]));
  expect((await saved()).webgpu).toBeUndefined();
  expect((await saved()).passes.Image.useViewerCamera).toBeUndefined();
  const fixed = await read();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await expect.poll(read).toBe(fixed);
  await pass.check();
  await expect.poll(async () => (await saved()).passes.Image.useViewerCamera).toBe(true);
  expect((await saved()).webgpu).toBeUndefined();
  await expect(pass).toBeChecked();
  await expect.poll(read).not.toBe(fixed);
  await page.reload();
  await expect(pass).toBeChecked();
  expect((await saved()).passes.Image.useViewerCamera).toBe(true);
  await expect(page.getByText('Viewer camera defaults', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Shader viewer camera')).toHaveCount(0);
  await pass.uncheck();
  await expect.poll(async () => (await saved()).passes.Image.useViewerCamera).toBe(false);
  await page.getByRole('button', { name: 'Use default', exact: true }).click();
  await expect.poll(async () => (await saved()).passes.Image.useViewerCamera).toBeUndefined();
  await expect(pass).not.toBeChecked();
  await page.getByTestId('shader-option-camera-other-wgsl').click();
  await expect(pass).not.toBeChecked();
  await changeGlobal(true);
  await expect(pass).toBeChecked();
});

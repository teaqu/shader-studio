import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

async function openFixture(page, stem, source) {
  await page.route('**/__native_entrypoint_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
  await page.goto('/__native_entrypoint_fixture__');
  await workspace(page, [
    [`${stem}.wgsl`, source],
    [`${stem}.sha.json`, JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } })],
  ]);
  await page.goto('/');
  await page.getByTestId(`shader-option-${stem}-wgsl`).click();
  await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
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
  await openFixture(page, stem, source);

  // The project default governs the first Buffer action. Switching it must
  // persist before adding the pass, so a reload retains the authoring choice.
  await page.getByLabel('New render pass authoring').selectOption('native');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Buffer (native entry points)' }).click();
  const buffer = page.locator('.tab-content').filter({ has: page.getByLabel('Render entry points') });
  await expect(buffer.getByLabel('Render authoring')).toHaveValue('native');
  await buffer.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(buffer.getByLabel('Vertex entrypoint')).toHaveValue('BufferAVertex');
  await expect(buffer.getByLabel('Fragment entrypoint')).toHaveValue('BufferAFragment');

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
    bufferPass: { entryPoints: { vertex: 'BufferAVertex', fragment: 'BufferAFragment' } },
    computePass: { type: 'compute', entryPoints: { compute: 'ComputeACompute' } },
  });

  const saved = await workspace(page);
  expect(saved[`/shaders/${stem}.wgsl`].match(/@vertex\s+fn BufferAVertex/g)).toHaveLength(1);
  expect(saved[`/shaders/${stem}.wgsl`].match(/@compute @workgroup_size/g)).toHaveLength(1);

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

  await page.getByLabel('Render authoring').selectOption('native');
  await expect(page.getByLabel('Vertex entrypoint')).toHaveValue('vertexA');
  await page.getByLabel('Fragment entrypoint').selectOption('fragmentB');
  await page.getByLabel('Render authoring').selectOption('hooks');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('menuitem', { name: 'Buffer (ShaderToy hooks)' }).click();

  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`])).toMatchObject({
    passes: { Image: { inputs: {} }, BufferA: { inputs: {} } },
  });
  const config = JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]);
  expect(config.passes.Image.entryPoints).toBeUndefined();
  expect(config.passes.BufferA.entryPoints).toBeUndefined();

  // Restore native mode and choose a fragment again. This proves the selector,
  // rather than the single-candidate fallback, is what reached saved JSON.
  await page.locator('[data-tab-name="Image"]').click();
  await page.getByLabel('Render authoring').selectOption('native');
  await page.getByLabel('Fragment entrypoint').selectOption('fragmentB');
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.entryPoints).toEqual({ vertex: 'vertexA', fragment: 'fragmentB' });
  await page.reload();
  await expect.poll(async () => JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.entryPoints).toEqual({ vertex: 'vertexA', fragment: 'fragmentB' });
});

test('new native WGSL Image compiles and makes native Buffer the default', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  await explorer.getByTitle('New Shader').click();
  const dialog = page.getByRole('dialog', { name: 'New Shader' });
  await dialog.getByLabel('Shader name').fill('native-image-created');
  await dialog.getByLabel('Shader language').selectOption('wgsl');
  await dialog.getByLabel('WebGPU authoring').selectOption('native');
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
  await page.getByRole('menuitem', { name: 'Buffer (native entry points)' }).click();
  await expect(page.getByLabel('Render authoring')).toHaveValue('native');
  await expect.poll(async () => JSON.parse((await workspace(page))['/shaders/native-image-created.sha.json']).passes.BufferA).toMatchObject({ entryPoints: {} });
});

test('new native Slang Image compiles, then inserts Buffer and Compute into the same source with canonical entries', async ({ page }) => {
  await page.goto('/');
  const explorer = page.getByTestId('web-shader-explorer');
  await explorer.getByTitle('New Shader').click();
  const dialog = page.getByRole('dialog', { name: 'New Shader' });
  await dialog.getByLabel('Shader name').fill('native-slang-created');
  await dialog.getByLabel('Shader language').selectOption('slang');
  await dialog.getByLabel('WebGPU authoring').selectOption('native');
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
  await page.getByRole('menuitem', { name: 'Buffer (native entry points)' }).click();
  await expect(page.getByLabel('Render authoring')).toHaveValue('native');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(page.getByLabel('Vertex entrypoint')).toHaveValue('BufferAVertex');
  await expect(page.getByLabel('Fragment entrypoint')).toHaveValue('BufferAFragment');

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

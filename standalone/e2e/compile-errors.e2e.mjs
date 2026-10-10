import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

// Headless Chromium needs this flag to expose a WebGPU adapter for Slang.
test.use({ launchOptions: { args: ['--enable-unsafe-webgpu'] } });

test.describe('renderer diagnostics', () => {
  for (const language of ['glsl', 'slang', 'wgsl']) {
    for (const separate of [false, true]) {
      test(`${language} renderer compile errors appear and clear in the ${separate ? 'separate' : 'main'} editor`, async ({ page }) => {
        await page.goto('/');
        await page.getByTestId(language === 'glsl'
          ? 'shader-option-aurora-glsl'
          : language === 'slang' ? 'shader-option-aurora-slang-slang' : 'shader-option-aurora-wgsl-wgsl').click();
        if (separate) {
          await page.getByRole('button', { name: 'Open in separate editor' }).click();
        }
        const editor = separate ? page.getByTestId('file-editor') : page.getByTestId('web-editor');
        const valid = language === 'glsl'
          ? 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }'
          : language === 'slang'
            ? 'float4 mainImage(float2 coord) { return float4(1.0); }'
            : 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }';
        const broken = language === 'wgsl'
          ? 'fn mainImage(coord: vec2f) -> vec4f {\n  let standalone_compile_regression = ;\n  return vec4f(1.0);\n}'
          : '#error standalone_compile_regression\n' + valid;
        await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText(broken);
        const status = page.getByTestId('web-preview').getByLabel('Toggle pause');
        await expect(status).toHaveClass(/error/);
        const markers = editor.locator('[data-marker-count]');
        await expect(markers).not.toHaveAttribute('data-marker-count', '0');
        await expect(editor.locator('.squiggly-error').first()).toBeVisible();
        await page.reload();
        await expect(editor.locator('.view-lines')).toContainText('standalone_compile_regression');
        await expect(markers).not.toHaveAttribute('data-marker-count', '0');
        await editor.locator('.view-lines').click({ position: { x: 80, y: 20 } });
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText(valid);
        await expect(status).not.toHaveClass(/error/);
        await expect(markers).toHaveAttribute('data-marker-count', '0');
        await expect(editor.locator('.squiggly-error')).toHaveCount(0);
      });
    }
  }
});

for (const language of ['slang', 'wgsl']) {
  for (const withVertex of [true, false]) {
    test(`unconfigured native ${language} selects first stages ${withVertex ? 'with' : 'without'} an authored vertex without creating config until selection`, async ({ page }) => {
      const stem = `unconfigured-native-${language}-${withVertex}`;
      const vertex = language === 'slang'
        ? `[shader("vertex")] float4 firstVertex(uint i : SV_VertexID) : SV_Position {
          float2 p[3] = {float2(-1,-1), float2(3,-1), float2(-1,3)};
          return float4(p[i],0,1);
        }`
        : `@vertex fn firstVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
          let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
          return vec4f(p[i],0,1);
        }`;
      const fragment = language === 'slang'
        ? '[shader("fragment")] float4 firstFragment() : SV_Target0 { return float4(1,0,0,1); }'
        : '@fragment fn firstFragment() -> @location(0) vec4f { return vec4f(1,0,0,1); }';
      const secondFragment = fragment.replaceAll('firstFragment', 'secondFragment').replace('1,0,0,1', '0,1,0,1');
      const secondVertex = vertex.replaceAll('firstVertex', 'secondVertex').replace('return float4(p[i],0,1)', 'return float4(0,0,0,1)').replace('return vec4f(p[i],0,1)', 'return vec4f(0,0,0,1)');
      await page.route('**/__unconfigured_native_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
      await page.goto('/__unconfigured_native_fixture__');
      await workspace(page, [[`${stem}.${language}`, [withVertex ? vertex : '', fragment, secondFragment, withVertex ? secondVertex : ''].join('\n')]]);
      await page.goto('/');
      await page.getByTestId(`shader-option-${stem}-${language}`).click();
      const preview = page.getByTestId('web-preview');
      const assertRendered = async (color = [255, 0, 0, 255], configExists = false) => {
        await expect.poll(() => preview.locator('canvas').first().evaluate(async canvas => {
          const bitmap = await createImageBitmap(await (await fetch(canvas.toDataURL())).blob());
          const sample = new OffscreenCanvas(1, 1);
          const context = sample.getContext('2d');
          context.drawImage(bitmap, bitmap.width / 2, bitmap.height / 2, 1, 1, 0, 0, 1, 1);
          const pixel = [...context.getImageData(0, 0, 1, 1).data];
          bitmap.close();
          return pixel;
        })).toEqual(color);
        await expect(preview.getByLabel('Toggle pause')).not.toHaveClass(/error/);
        expect(Boolean((await workspace(page))[`/shaders/${stem}.sha.json`])).toBe(configExists);
      };
      await assertRendered();
      await page.reload();
      await assertRendered();
      await preview.getByLabel('Toggle config panel').click();
      const annotation = stage => language === 'slang' ? `[shader("${stage}")]` : `@${stage}`;
      await expect(page.getByRole('radio', { name: `${annotation('fragment')} firstFragment`, exact: true })).toBeChecked();
      if (withVertex) {
        await expect(page.getByRole('radio', { name: `${annotation('vertex')} firstVertex`, exact: true })).toBeChecked();
      }
      expect((await workspace(page))[`/shaders/${stem}.sha.json`]).toBeUndefined();
      await page.getByRole('radio', { name: `${annotation('fragment')} secondFragment`, exact: true }).check();
      await assertRendered([0, 255, 0, 255], true);
      expect(JSON.parse((await workspace(page))[`/shaders/${stem}.sha.json`]).passes.Image.entryPoints).toEqual({
        ...(withVertex ? { vertex: 'firstVertex' } : {}), fragment: 'secondFragment',
      });
      await page.reload();
      await assertRendered([0, 255, 0, 255], true);
    });
  }
}

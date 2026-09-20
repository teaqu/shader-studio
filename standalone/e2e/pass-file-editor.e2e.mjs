import { expect, test } from '@playwright/test';
import { workspace } from './language-service-fixtures.mjs';

const fixtures = [
  {
    language: 'WGSL', extension: 'wgsl', elementType: 'vec4<f32>',
    image: 'fn mainImage(coord: vec2f) -> vec4f {\n  return particles[0];\n}\n',
    compute: '@compute @workgroup_size(1, 1, 1)\nfn simulate(@builtin(global_invocation_id) id: vec3u) {\n  particles[id.x] = vec4f(1.0);\n  let sentinel = notDeclaredHere;\n}\n',
  },
  {
    language: 'Slang', extension: 'slang', elementType: 'float4',
    image: 'float4 mainImage(float2 coord) {\n  return particles[0];\n}\n',
    compute: '[shader("compute")]\n[numthreads(1, 1, 1)]\nvoid simulate(uint3 id : SV_DispatchThreadID) {\n  particles[id.x] = float4(1.0);\n  float sentinel = notDeclaredHere;\n}\n',
  },
];

for (const fixture of fixtures) {
  test(`${fixture.language} pass files opened on their own know the configured storage`, async ({ page }) => {
    const stem = `passfile-${fixture.extension}`;
    await page.route('**/__pass_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
    await page.goto('/__pass_fixture__');
    await workspace(page, [
      [`${stem}.${fixture.extension}`, fixture.image],
      [`${stem}/sim.buffer.${fixture.extension}`, fixture.compute],
      [`${stem}.sha.json`, JSON.stringify({
        version: '1.0',
        storage: { particles: { count: 4, elementType: fixture.elementType } },
        passes: {
          Sim: { type: 'compute', path: `${stem}/sim.buffer.${fixture.extension}`, entryPoint: 'simulate' },
          Image: { inputs: {} },
        },
      })],
    ]);
    await page.goto('/');
    await page.getByTestId(`shader-option-${stem}-${fixture.extension}`).click();
    await page.getByTestId('web-preview').getByLabel('Toggle config panel').click();
    await page.locator('[data-tab-name="Sim"]').dblclick();

    const editor = page.locator(`[data-testid="file-editor"][data-path="/shaders/${stem}/sim.buffer.${fixture.extension}"]`);
    await expect(editor.locator('.monaco-editor')).toBeVisible();

    // The file carries one deliberate undefined identifier, so waiting for a
    // squiggle proves the language service ran before anything is asserted
    // absent. `particles` is declared by the config rather than the file: a
    // pass editor that does not know its owning shader marks it undefined too,
    // which would be a second squiggle.
    await expect(editor.locator('.squiggly-error').first()).toBeVisible();
    await expect(editor.locator('.squiggly-error')).toHaveCount(1);

    const box = await editor.locator('.squiggly-error').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.monaco-hover-content, .hover-contents').first()).toContainText('notDeclaredHere');
  });
}

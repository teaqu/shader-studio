import { expect, it } from 'vitest';
import { GlslLanguageService, GLSL_INTRINSICS, findGlslIntrinsics } from '../index';
import { GlslLanguageService as Implementation } from '../GlslLanguageService';
import { GLSL_INTRINSICS as intrinsicDefinitions } from '../intrinsics';

it('exports the GLSL language service and intrinsic definitions through its public entry', async () => {
  expect(GlslLanguageService).toBe(Implementation);
  expect(GLSL_INTRINSICS).toBe(intrinsicDefinitions);
  expect(findGlslIntrinsics('normalize', 300, 'fragment')).toEqual(intrinsicDefinitions.filter(item => item.name === 'normalize'));
  const service = new GlslLanguageService();
  expect(await service.initialize()).toMatchObject({ completion: true, diagnostics: true, rename: true });
});

it('removes language features for a closed document', async () => {
  const service = new GlslLanguageService();
  const uri = 'file:///workspace/closed.glsl';
  await service.syncEnvironment({ documentUri: uri, languageId: 'glsl', generation: 1, passName: 'Image',
    stage: 'fragment', customUniforms: [], resources: [], virtualFiles: [] });
  await service.openDocument({ uri, languageId: 'glsl', version: 1, text: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }' });
  const params = { document: { uri, languageId: 'glsl' as const, version: 1, environmentGeneration: 1 }, position: { line: 0, character: 60 } };
  expect((await service.completion(params)).length).toBeGreaterThan(0);
  await service.closeDocument(uri);
  expect(await service.completion(params)).toEqual([]);
  expect(await service.diagnostics(params)).toEqual([]);
});

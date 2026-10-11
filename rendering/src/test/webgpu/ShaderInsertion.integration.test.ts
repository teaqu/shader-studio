import { beforeAll, expect, it } from 'vitest';
import SlangModuleFactory from '../../../../ui/src/slang/slang-wasm.js';
import { createShaderInsertion } from '@shader-studio/types';
import { SlangCompiler } from '../../webgpu/SlangCompiler';
import type { SlangModuleApi } from '../../webgpu/slangTypes';
import { slangWasmPath } from './slangWasmPath';

let compiler: SlangCompiler;
beforeAll(async () => {
  compiler = new SlangCompiler(await SlangModuleFactory({ locateFile: () => slangWasmPath() }) as SlangModuleApi);
});
it.each(['fullscreen', 'cube'] as const)('compiles a native Slang %s fragment with the viewer vertex stage', geometry => {
  const inserted = createShaderInsertion('', { fileType: 'slang-buffer', authoringMode: 'native' });
  expect(inserted.entryPoints?.vertex).toBeUndefined();
  const result = compiler.compileImagePass(inserted.text, { geometry, renderEntryPoints: inserted.entryPoints });
  expect(result.success, JSON.stringify(result)).toBe(true);
});
it.each(['fullscreen', 'cube', 'vertices'] as const)('compiles an inserted native Slang %s vertex with the existing built-in fragment', geometry => {
  const source = 'float4 mainImage(float2 coord) { return float4(1); }';
  const inserted = createShaderInsertion(source, { fileType: 'slang-vertex', authoringMode: 'native', geometryType: geometry, vertexSpace: 'clip' });
  const result = compiler.compileImagePass(source + inserted.text, { geometry, vertexSpace: 'clip', renderEntryPoints: inserted.entryPoints });
  expect(result.success, JSON.stringify(result)).toBe(true);
});

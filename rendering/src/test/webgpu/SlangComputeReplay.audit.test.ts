import { beforeAll, describe, expect, it } from 'vitest';
import SlangModuleFactory from '../../../../ui/src/slang/slang-wasm.js';
import { SlangDebugEngine } from '../../../../debug/src';
import { SlangCompiler } from '../../webgpu/SlangCompiler';
import type { SlangModuleApi } from '../../webgpu/slangTypes';

// Compiler-stage evidence, deliberately separate from GPU execution evidence.
describe('Slang compute replay compiler audit', () => {
  let compiler: SlangCompiler;
  beforeAll(async () => {
    const slang = await SlangModuleFactory({ locateFile: () => new URL('../../../../ui/src/slang/slang-wasm.wasm', import.meta.url).pathname.replace(/^\/@fs/, '') }) as SlangModuleApi;
    compiler = new SlangCompiler(slang);
  });
  for (const mode of ['preview', 'capture'] as const) {
    it.each([
      ['workgroup', 'groupshared float sharedValues[4];', 'sharedValues[id.x % 4] = 0.375;', 'sharedValues[id.x % 4]'],
      ['barrier', '', 'GroupMemoryBarrierWithGroupSync();', '0.375'],
      ['atomic', 'groupshared Atomic<uint> counter;', 'uint old = counter.add(1);', 'float(old)'],
      ['subgroup', '', '', 'WaveActiveSum(1.0)'],
      ['storage-write', '', 'values[0] = 0.375;', 'values[0]'],
      ['storage-read', '', '', 'values[0]'],
    ])(`${mode} audits %s`, (name, declarations, operation, expression) => {
      const source = `${declarations}\n[shader("compute")]\n[numthreads(4,1,1)]\nvoid update(uint3 id : SV_DispatchThreadID) {\n  ${operation}\n  float shade = ${expression};\n  writeOutput(id.xy, float4(shade));\n}`;
      const storage = name.startsWith('storage') ? [{ name: 'values', elementType: 'float', count: 1, binding: 0, builtin: true, stride: 4 }] : [];
      const native = compiler.compileImagePass(source, { passName: 'Compute', passKind: 'compute', entryPoint: 'update', hasOutput: true, storage });
      expect(native.success, JSON.stringify(native)).toBe(true);
      const request = { workspace: { rootUri: '/compute.slang', rootPath: '/compute.slang', passName: 'Compute', contentHash: 'audit1234', compute: { entryPoint: 'update', storageNames: storage.map(item => item.name) },
        files: [{ uri: '/compute.slang', path: '/compute.slang', source, version: 1, moduleName: '', ownerPass: 'Compute' }],
      }, sourceUri: '/compute.slang', position: { line: 5, character: 2 } };
      const engine = new SlangDebugEngine();
      const analysis = engine.analyze(request);
      if (!analysis.ok) {
        throw new Error(JSON.stringify(analysis));
      }
      const shade = analysis.analysis.visibleValues.find(value => value.name === 'shade')!;
      const plan = mode === 'preview' ? engine.planPreview(request, { normalizeMode: 'off', stepEdge: null }) : engine.planCapture(request, [shade.id]);
      if (name !== 'storage-read') {
        expect(plan).toMatchObject({ ok: false, diagnostics: [{ code: 'slang-debug-unsupported-syntax', message: expect.stringContaining('Slang compute replay does not support') }] });
        return;
      }
      if (!plan.ok) {
        throw new Error(JSON.stringify(plan));
      }
      const replay = compiler.compileImagePass(plan.plan.files[0].source, { passName: 'Image', storage, captureMode: mode === 'capture' });
      expect(replay.success, JSON.stringify(replay)).toBe(true);
      expect(plan.plan.files[0].source).not.toContain('[shader("compute")]');
    });
  }
});

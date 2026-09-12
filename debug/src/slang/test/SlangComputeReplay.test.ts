import { describe, expect, it } from 'vitest';
import { SlangDebugEngine } from '../SlangDebugEngine';
import { createSlangWorkspace } from '../SlangWorkspace';
import { slangComputeReplayLimitation } from '../SlangComputeReplay';

const cases = [
  ['workgroup memory', 'groupshared float sharedValues[4];', 'sharedValues[0] = 0.375;'],
  ['barriers', '', 'GroupMemoryBarrierWithGroupSync();'],
  ['atomics', 'groupshared Atomic<uint> counter;', 'uint old = counter.add(1);'],
  ['subgroup operations', '', 'float total = WaveActiveSum(0.125);'],
  ['writes to configured storage', '', 'values[0] = 0.375;'],
] as const;
for (const mode of ['preview', 'capture'] as const) {
  describe(`Slang ${mode} compute replay safety`, () => {
    it.each(cases)('rejects %s explicitly', (_name, declaration, operation) => {
      const source = `${declaration}\n[shader("compute")]\n[numthreads(1,1,1)]\nvoid update(uint3 id : SV_DispatchThreadID) {\n  ${operation}\n  float shade = 0.375;\n  writeOutput(id.xy, float4(shade));\n}`;
      const uri = '/compute.slang';
      const request = { workspace: { rootUri: uri, rootPath: uri, passName: 'Compute', contentHash: 'abcd1234', compute: { entryPoint: 'update', storageNames: ['values'] },
        files: [{ uri, path: uri, source, version: 1, moduleName: '', ownerPass: 'Compute' }],
      }, sourceUri: uri, position: { line: 5, character: 2 } };
      const engine = new SlangDebugEngine();
      const analysis = engine.analyze(request);
      if (!analysis.ok) {
        throw new Error(JSON.stringify(analysis));
      }
      const value = analysis.analysis.visibleValues.find(value => value.name === 'shade')!;
      const result = mode === 'preview' ? engine.planPreview(request, { normalizeMode: 'off', stepEdge: null }) : engine.planCapture(request, [value.id]);
      expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'slang-debug-unsupported-syntax', message: expect.stringMatching(/Slang compute replay does not support/), sourceUri: 'file:///compute.slang' }] });
    });
  });
}


function limitation(source: string) {
  const uri = '/compute.slang';
  const workspace = createSlangWorkspace({ rootUri: uri, rootPath: uri, passName: 'Compute', contentHash: 'abcd1234',
    compute: { entryPoint: 'update', storageNames: ['values'] },
    files: [{ uri, path: uri, source, version: 1, moduleName: '', ownerPass: 'Compute' }],
  });
  if (!workspace.ok) {
    throw new Error(JSON.stringify(workspace));
  }
  return slangComputeReplayLimitation(workspace.workspace);
}

it.each(['values[i + 1] += 1;', 'values[i].field = 1;', '++values[i];', 'values[i]--;', 'values[i].add(1);', 'values[i] |= 1;', 'modify(&values[i]);'])(
  'rejects storage mutations: %s', source => expect(limitation(source)).toContain('writes to configured storage'),
);
it.each(['float shade = values[i];', 'float shade = values[i].field;', '// groupshared WaveActiveSum values[0] = 1;\nfloat shade = 0.375;', 'const char* label = "GroupMemoryBarrier";'])(
  'allows storage reads and ignores comments/strings: %s', source => expect(limitation(source)).toBeUndefined(),
);
it('does not apply compute restrictions to a fragment shader', () => {
  const uri = '/image.slang';
  const source = 'float4 mainImage(float2 p) {\n  float shade = WaveActiveSum(0.125);\n  return float4(shade);\n}';
  const request = { workspace: { rootUri: uri, rootPath: uri, passName: 'Image', contentHash: 'abcd1234', files: [{ uri, path: uri, source, version: 1, moduleName: '', ownerPass: 'Image' }] }, sourceUri: uri, position: { line: 1, character: 2 } };
  expect(new SlangDebugEngine().planPreview(request, { normalizeMode: 'off', stepEdge: null }).ok).toBe(true);
});

it('does not reject a local that shadows a configured storage name', () => {
  expect(limitation('void helper() { float values[2]; values[0] = 0.375; }')).toBeUndefined();
});
it('checks used macro bodies but ignores inactive operations', () => {
  expect(limitation('#define SUM WaveActiveSum\nfloat shade = SUM(0.125);')).toContain('subgroup operations');
  expect(limitation('#if 0\nGroupMemoryBarrier();\n#endif\nfloat shade = 0.375;')).toBeUndefined();
  expect(limitation('#define UNUSED WaveActiveSum\nfloat shade = 0.375;')).toBeUndefined();
});

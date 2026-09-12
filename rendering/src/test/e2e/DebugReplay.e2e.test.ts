import { describe, expect, it } from 'vitest';
import { SlangDebugEngine, WgslDebugEngine } from '../../../../debug/src';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

function preview(language: 'wgsl' | 'slang', source: string, line: number) {
  const uri = `/image.${language}`;
  const request = { workspace: { rootUri: uri, rootPath: uri, passName: 'Image', contentHash: 'abcd1234',
    files: [{ uri, path: uri, source, version: 1, moduleName: '', ownerPass: 'Image' }],
  }, sourceUri: uri, position: { line, character: 2 } };
  const engine = language === 'wgsl' ? new WgslDebugEngine() : new SlangDebugEngine();
  const plan = engine.planPreview(request, { normalizeMode: 'off', stepEdge: null });
  if (!plan.ok) {
    throw new Error(JSON.stringify(plan));
  }
  return plan.plan.files[0].source;
}

describe('debug replay numeric GPU evidence', () => {
  it.each(['wgsl', 'slang'] as const)('%s captures keyword-prefix assignments after execution', async language => {
    const harness = createShaderCanvasHarness(language);
    try {
      for (const value of [0.375, 0.625]) {
        const source = language === 'wgsl'
          ? `fn mainImage(p: vec2f) -> vec4f {\n  var formula: f32 = 0.125;\n  formula = ${value};\n  return vec4f(formula);\n}`
          : `float4 mainImage(float2 p) {\n  float formula = 0.125;\n  formula = ${value};\n  return float4(formula);\n}`;
        await harness.compile({ image: preview(language, source, 2) });
        const expected = Math.round(value * 255);
        for (const pixel of await harness.renderAndReadPixels()) {
          expect(pixel.slice(0, 3)).toEqual([expected, expected, expected]);
        }
      }
    } finally {
      harness.dispose();
    }
  });
});

describe('Slang cooperative compute replay GPU audit', () => {
  it.each([
    ['workgroup/barrier', 'groupshared float sharedValues[4];', 'uint index = id.y * 2 + id.x; sharedValues[index] = float(index + 1) / 8.0;\n  GroupMemoryBarrierWithGroupSync();', 'sharedValues[(index + 1) % 4]'],
    ['atomic', 'groupshared Atomic<uint> counter;', 'uint old = counter.add(1);', 'float(old) / 8.0'],
    ['subgroup', '', '', 'WaveActiveSum(0.00390625)'],
  ])('%s executes natively but cannot promise faithful fragment replay', async (name, declarations, operation, expression) => {
    const source = `${declarations}\n[shader("compute")]\n[numthreads(2,2,1)]\nvoid update(uint3 id : SV_DispatchThreadID) {\n  ${operation}\n  float shade = ${expression};\n  writeOutput(id.xy, float4(shade,0,0,1));\n}`;
    const harness = createShaderCanvasHarness('slang');
    try {
      await harness.compile({
        image: 'float4 mainImage(float2 p) { return sample2DLevel(result.texture,result.sampler,p/iResolution.xy,0); }',
        buffers: { Compute: source },
        config: { version: '1', passes: {
          Image: { inputs: { result: { type: 'buffer', source: 'Compute' } } },
          Compute: { type: 'compute', path: 'compute.slang', entryPoint: 'update' },
        } },
      });
      const native = await harness.renderAndReadPixels();
      const red = native.map(pixel => pixel[0]).sort((a, b) => a - b);
      if (name === 'workgroup/barrier') {
        expect(red).toEqual([32, 64, 96, 128]);
      } else if (name === 'atomic') {
        expect(red).toEqual([0, 32, 64, 96]);
      } else {
        expect(red.every(value => value > 0)).toBe(true);
      }
      expect(native.every(pixel => pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255)).toBe(true);
      const line = source.split('\n').findIndex(line => line.includes('float shade'));
      expect(() => preview('slang', source, line)).toThrow(/Slang compute replay does not support/);
    } finally {
      harness.dispose();
    }
  });
});

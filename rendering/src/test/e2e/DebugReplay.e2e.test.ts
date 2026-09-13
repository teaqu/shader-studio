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

describe('2x2 matrix preview numeric GPU evidence', () => {
  // Four distinct components prove column order: column 0 packs R/G, column 1 B/A.
  const expected = [0.125, 0.25, 0.5, 0.75].map(value => Math.round(value * 255));
  it.each([
    ['wgsl', 'annotated mat2x2f', 'fn mainImage(p: vec2f) -> vec4f {\n  let m: mat2x2f = mat2x2f(0.125, 0.25, 0.5, 0.75);\n  return vec4f(m[0], m[1]);\n}'],
    ['wgsl', 'inferred mat2x2<f32>', 'fn mainImage(p: vec2f) -> vec4f {\n  let m = mat2x2<f32>(vec2f(0.125, 0.25), vec2f(0.5, 0.75));\n  return vec4f(m[0], m[1]);\n}'],
    ['wgsl', 'Common-style helper return', 'fn basis() -> mat2x2f {\n  return mat2x2f(0.125, 0.25, 0.5, 0.75);\n}\nfn mainImage(p: vec2f) -> vec4f {\n  return vec4f(basis()[0], basis()[1]);\n}'],
    ['slang', 'float2x2', 'float4 mainImage(float2 p) {\n  float2x2 m = float2x2(0.125, 0.25, 0.5, 0.75);\n  return float4(m[0], m[1]);\n}'],
  ] as const)('%s previews %s in authored component order', async (language, _label, source) => {
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ image: preview(language, source, 1) });
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual(expected);
      }
    } finally {
      harness.dispose();
    }
  });
});

interface StorageMatrixCase {
  readonly image: string;
  readonly common?: string;
  readonly compute?: boolean;
  readonly captureInCommon?: boolean;
  readonly line: number;
  readonly element: 0 | 1;
}

/** Plans a preview through the real debug engine and returns each instrumented file by uri. */
function planStoragePreview(language: 'wgsl' | 'slang', elementType: string, testCase: StorageMatrixCase): Map<string, string> {
  const imageUri = `/image.${language}`;
  const commonUri = `/common.${language}`;
  const files = [
    ...(testCase.common ? [{ uri: commonUri, path: commonUri, source: testCase.common, version: 1, moduleName: '', ownerPass: 'Image' }] : []),
    { uri: imageUri, path: imageUri, source: testCase.image, version: 1, moduleName: '', ownerPass: testCase.compute ? 'Compute' : 'Image' },
  ];
  const request = {
    workspace: {
      rootUri: imageUri, rootPath: imageUri, passName: testCase.compute ? 'Compute' : 'Image', contentHash: 'abcd1234',
      storage: { bases: { elementType } },
      ...(testCase.compute ? { compute: { entryPoint: 'update', storageNames: ['bases'] } } : {}),
      files,
    },
    sourceUri: testCase.captureInCommon ? commonUri : imageUri,
    position: { line: testCase.line, character: 2 },
  };
  const engine = language === 'wgsl' ? new WgslDebugEngine() : new SlangDebugEngine();
  const plan = engine.planPreview(request, { normalizeMode: 'off', stepEdge: null });
  if (!plan.ok) {
    throw new Error(JSON.stringify(plan));
  }
  return new Map(plan.plan.files.map(file => [file.uri, file.source]));
}

describe('storage-backed 2x2 matrix preview numeric GPU evidence', () => {
  // Two stored elements with four distinct components each. Column 0 is the
  // first eight bytes, so a correct capture reads the buffer in order.
  const stored = [0.125, 0.25, 0.5, 0.75, 0.75, 0.5, 0.25, 0.125];
  const edited = [0.625, 0.375, 0.875, 0.5];
  const toBytes = (values: readonly number[]) => values.map(value => Math.round(value * 255));
  it.each([
    ['wgsl', 'an inferred mat2x2<f32> element', 'mat2x2<f32>', { image: 'fn mainImage(p: vec2f) -> vec4f {\n  let m = bases[0];\n  return vec4f(m[0], m[1]);\n}', line: 1, element: 0 }],
    ['wgsl', 'an annotated mat2x2f element', 'mat2x2f', { image: 'fn mainImage(p: vec2f) -> vec4f {\n  let m: mat2x2f = bases[1];\n  return vec4f(m[0], m[1]);\n}', line: 1, element: 1 }],
    ['wgsl', 'a Common helper local', 'mat2x2<f32>', {
      common: 'fn basisAt(index: u32) -> mat2x2f {\n  let basis = bases[index];\n  return basis;\n}',
      image: 'fn mainImage(p: vec2f) -> vec4f {\n  let m = basisAt(0u);\n  return vec4f(m[0], m[1]);\n}',
      captureInCommon: true, line: 1, element: 0,
    }],
    ['wgsl', 'a compute replay read', 'mat2x2<f32>', {
      image: '@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) {\n  let m = bases[1];\n  writeOutput(id.xy, vec4f(m[0], m[1]));\n}',
      compute: true, line: 1, element: 1,
    }],
    ['slang', 'a float2x2 element', 'float2x2', { image: 'float4 mainImage(float2 p) {\n  float2x2 m = bases[0];\n  return float4(m[0], m[1]);\n}', line: 1, element: 0 }],
  ] as const)('%s previews %s from configured storage in buffer order and follows live edits', async (language, _label, elementType, testCase) => {
    const planned = planStoragePreview(language, elementType, testCase);
    // Planners key files by their canonical URI, which differs between languages.
    const plannedSource = (name: string) => [...planned].find(([uri]) => uri.endsWith(`/${name}.${language}`))?.[1];
    const image = plannedSource('image');
    const common = plannedSource('common');
    if (image === undefined) {
      throw new Error(`No planned image source among ${[...planned.keys()].join(', ')}`);
    }
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({
        image,
        ...(common !== undefined ? { buffers: { common } } : {}),
        config: {
          version: '1',
          storage: { bases: { count: 2, elementType } },
          passes: { Image: {}, ...(common !== undefined ? { common: { path: `common.${language}` } } : {}) },
        } as never,
      });
      const engine = harness.engine as unknown as { writeStorageBuffer(name: string, start: number, data: ArrayBuffer): Promise<void> };
      await engine.writeStorageBuffer('bases', 0, new Float32Array(stored).buffer);
      const initial = toBytes(stored.slice(testCase.element * 4, testCase.element * 4 + 4));
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual(initial);
      }
      await engine.writeStorageBuffer('bases', testCase.element, new Float32Array(edited).buffer);
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual(toBytes(edited));
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

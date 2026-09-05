// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SlangCompiler } from '../../webgpu/SlangCompiler';
import type { SlangModuleApi } from '../../webgpu/slangTypes';

let compiler: SlangCompiler;
const channels = [{ slot: 0, key: 'iChannel0' }, { slot: 3, key: 'sky', kind: 'cubemap' as const }];
beforeAll(async () => {
  const url = new URL('../../../../ui/src/slang/slang-wasm.js', import.meta.url);
  const runtime = await import(/* @vite-ignore */ url.href) as { default: () => Promise<SlangModuleApi> };
  compiler = new SlangCompiler(await runtime.default());
}, 30_000);

afterAll(() => compiler?.dispose());

describe('native Slang input objects compile to WGSL', () => {
  it.each([
    'inputs.iChannel0.Sample(c)',
    'inputs.iChannel0.SampleLevel(c, 2.0)',
    'inputs.iChannel0.SampleGrad(c, float2(0.1, 0), float2(0, 0.1))',
    'inputs.iChannel0.Sample(inputs.iChannel0.sampler, c)',
    'inputs.iChannel0.SampleLevel(inputs.iChannel0.sampler, c, 2)',
    'inputs.iChannel0.SampleGrad(inputs.iChannel0.sampler, c, float2(0.1, 0), float2(0, 0.1))',
    'inputs.sky.Sample(inputs.sky.sampler, float3(c, 1))',
    'inputs.sky.SampleLevel(inputs.sky.sampler, float3(c, 1), 2)',
    'inputs.sky.SampleGrad(inputs.sky.sampler, float3(c, 1), float3(0.1, 0, 0), float3(0, 0.1, 0))',
    'inputs.iChannel0.texture.Sample(inputs.iChannel0.sampler, c)',
    'inputs.sky.Sample(float3(c, 1))',
    'inputs.sky.SampleLevel(float3(c, 1), 1)',
    'inputs.sky.SampleGrad(float3(c, 1), float3(0.1, 0, 0), float3(0, 0.1, 0))',
    'float4(float2(inputs.iChannel0.size), inputs.iChannel0.time, inputs.iChannel0.loaded ? 1.0 : 0.0)',
  ])('compiles %s', (expression) => {
    const result = compiler.compileImagePass(`float4 mainImage(float2 c) { return ${expression}; }`, { channels });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
  it('passes an input to reusable functions and preserves sparse GPU bindings', () => {
    const result = compiler.compileImagePass(`
float4 read(ShaderStudioChannel2D input, float2 uv) { return input.Sample(uv); }
float4 mainImage(float2 c) { return read(inputs.iChannel0, c) + inputs.sky.Sample(float3(c, 1)); }`, { channels });
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) {
      expect(result.wgsl).toContain('@binding(1)');
      expect(result.wgsl).toContain('@binding(3)');
    }
  });
  it.each(['SampleLevel(c, 1)', 'SampleGrad(c, float2(0.1, 0), float2(0, 0.1))'])('allows explicit sampling in compute and vertex: %s', (call) => {
    const compute = compiler.compileImagePass(`[shader("compute")] [numthreads(1, 1, 1)]
void run(uint3 id : SV_DispatchThreadID) { float2 c = float2(id.xy); writeOutput(id.xy, inputs.iChannel0.${call}); }`,
    { channels, passKind: 'compute', hasOutput: true });
    expect(compute.success, JSON.stringify(compute)).toBe(true);
    const vertex = compiler.compileImagePass('float4 mainImage(float2 c) { return 1; }', {
      channels, vertexCode: `void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { float2 c = uv; position.x += inputs.iChannel0.${call}.x; }`,
    });
    expect(vertex.success, JSON.stringify(vertex)).toBe(true);
  });
  it('rejects implicit sampling from compute instead of silently using level zero', () => {
    const result = compiler.compileImagePass(`[shader("compute")] [numthreads(1, 1, 1)]
void run(uint3 id : SV_DispatchThreadID) { writeOutput(id.xy, inputs.iChannel0.Sample(float2(id.xy))); }`,
    { channels, passKind: 'compute', hasOutput: true });
    expect(result.success).toBe(false);
  });
  it.each(['sampleIChannel0(c)', 'iCh0.sampler.Sample(c)', 'iChannel0.Sample(iChannel0Sampler, c)', 'float4(iChannelResolution[0], 1)', 'float4(iChannelTime[0])', 'float4(iChannelLoaded[0])', 'inputs.missing.Sample(c)', 'inputs.sky.Sample(c)', 'inputs.iChannel0.Sample(float3(c, 1))'])('rejects removed or missing symbols: %s', (expression) => {
    const result = compiler.compileImagePass(`float4 mainImage(float2 c) { return ${expression}; }`, { channels });
    expect(result.success).toBe(false);
  });
});

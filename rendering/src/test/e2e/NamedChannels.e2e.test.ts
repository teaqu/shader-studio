import { describe, expect, it } from 'vitest';
import { createShaderCanvasHarness, type ShaderLanguage } from './ShaderCanvasHarness';

const expected = [[0, 255, 0, 255], [255, 255, 0, 255], [0, 0, 0, 255], [255, 0, 0, 255]];
const cases: Array<[ShaderLanguage, string]> = [
  ['glsl', 'texture(albedo.sampler, uv)'],
  ['glsl', 'texture(albedo, uv)'],
  ['slang', 'albedo.Sample(uv)'],
  ['slang', 'albedo.SampleLevel(uv, 0)'],
  ['slang', 'albedo.SampleGrad(uv, ddx(uv), ddy(uv))'],
  ['slang', 'sample2D(albedo.texture, albedo.sampler, uv)'],
  ['slang', 'sample2DLevel(albedo.texture, albedo.sampler, uv, 0)'],
  ['slang', 'sample2DGrad(albedo.texture, albedo.sampler, uv, ddx(uv), ddy(uv))'],
  ['wgsl', 'sample2D(albedoTexture, albedoSampler, uv)'],
  ['wgsl', 'sample2DLevel(albedoTexture, albedoSampler, uv, 0.0)'],
  ['wgsl', 'sample2DGrad(albedoTexture, albedoSampler, uv, dpdx(uv), dpdy(uv))'],
];

describe('named channel objects and portable sampling', () => {
  it.each(cases)('%s renders bottom-left pixels and metadata via %s', { timeout: 30_000 }, async (language, sample) => {
    const harness = createShaderCanvasHarness(language);
    try {
      const image = language === 'wgsl'
        ? `fn mainImage(c: vec2f) -> vec4f { let uv = c / iResolution.xy;
          if (!albedo.loaded || any(albedo.size != vec2u(2)) || albedo.time != 0.0) { return vec4f(1,0,1,1); }
          return ${sample}; }`
        : language === 'slang'
          ? `float4 mainImage(float2 c) { float2 uv = c / iResolution.xy;
            if (!albedo.loaded || any(albedo.size != uint2(2)) || albedo.time != 0) return float4(1,0,1,1);
            return ${sample}; }`
          : `void mainImage(out vec4 color, in vec2 c) { vec2 uv = c / iResolution.xy;
            if (albedo.loaded != 1 || any(notEqual(albedo.size.xy, vec2(2))) || albedo.time != 0.) { color = vec4(1,0,1,1); return; }
            color = ${sample}; }`;
      const pattern = language === 'wgsl'
        ? 'fn mainImage(c: vec2f) -> vec4f { return vec4f(f32(c.x >= 1), f32(c.y >= 1), 0, 1); }'
        : language === 'slang'
          ? 'float4 mainImage(float2 c) { return float4(float2(c.x >= 1, c.y >= 1), 0, 1); }'
          : 'void mainImage(out vec4 color, in vec2 c) { color = vec4(vec2(c.x >= 1., c.y >= 1.),0,1); }';
      await harness.compile({ image, buffers: { Pattern: pattern }, config: { version: '1', passes: {
        Image: { inputs: { albedo: { type: 'buffer', source: 'Pattern' } } },
        Pattern: { path: `pattern.${language}`, resolution: { width: 2, height: 2 } },
      } } });
      expect(await harness.renderAndReadPixels()).toEqual(expected);
    } finally {
      harness.dispose();
    }
  });

  it('WGSL shares bindings across differently named handles without breaking source coordinates', { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness('wgsl');
    try {
      await harness.compile({
        image: `fn mainImage(c: vec2f) -> vec4f {
          let a = sample2DLevel(shortTexture, shortSampler, c / iResolution.xy, 0);
          let b = sample2DLevel(longerAliasTexture, longerAliasSampler, c / iResolution.xy, 0);
          return vec4f(a.r, b.g, 0, 1);
        }`,
        buffers: { Pattern: 'fn mainImage(c: vec2f) -> vec4f { return vec4f(1,1,0,1); }' },
        config: { version: '1', passes: {
          Image: { inputs: { short: { type: 'buffer', source: 'Pattern' }, longerAlias: { type: 'buffer', source: 'Pattern' } } },
          Pattern: { path: 'pattern.wgsl' },
        } },
      });
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255,255,0,255]));
    } finally {
      harness.dispose();
    }
  });
});

it.each(['slang', 'wgsl'] as const)('%s portable sampling preserves mip levels and per-call samplers', { timeout: 30_000 }, async language => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'red'; ctx.fillRect(0,0,2,1);
  ctx.fillStyle = 'blue'; ctx.fillRect(0,1,2,1);
  const path = canvas.toDataURL();
  const call = (sampler: string, uv: string, lod: number) => language === 'slang'
    ? `sample2DLevel(albedo.texture, ${sampler}.sampler, float2(${uv}), ${lod})`
    : `sample2DLevel(albedoTexture, ${sampler}Sampler, vec2f(${uv}), ${lod})`;
  // Repeat selects the opposite row to clamp; their red values differ by one.
  const expression = `abs(${call('albedo', '0.25, 1.25', 0)}.r - ${call('clamped', '0.25, 1.25', 0)}.r)`;
  const mip = call('albedo', '0.25, 0.25', 1);
  const image = language === 'slang'
    ? `float4 mainImage(float2 p) { return float4(${expression}, ${mip}.r, ${mip}.b, 1); }`
    : `fn mainImage(p: vec2f) -> vec4f { return vec4f(${expression}, ${mip}.r, ${mip}.b, 1); }`;
  const harness = createShaderCanvasHarness(language);
  try {
    await harness.compile({ image, config: { version: '1', passes: { Image: { inputs: {
      albedo: { type: 'texture', path, filter: 'mipmap', wrap: 'repeat', vflip: true },
      clamped: { type: 'texture', path, filter: 'mipmap', wrap: 'clamp', vflip: true },
    } } } } });
    for (const pixel of await harness.renderAndReadPixels()) {
      expect(pixel[0]).toBe(255);
      expect(pixel[1]).toBeGreaterThanOrEqual(127);
      expect(pixel[1]).toBeLessThanOrEqual(128);
      expect(pixel[2]).toBeGreaterThanOrEqual(127);
      expect(pixel[2]).toBeLessThanOrEqual(128);
      expect(pixel[3]).toBe(255);
    }
  } finally {
    harness.dispose();
  }
});

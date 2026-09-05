import { describe, expect, it } from 'vitest';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

const pattern = `float4 mainImage(float2 c) {
  return float4(float2(c.x >= 1.0, c.y >= 1.0), 0, 1);
}`;

describe('Slang typed inputs rendering', () => {
  it.each([
    'inputs.pattern.Sample(uv)',
    'inputs.pattern.SampleLevel(uv, 0.0)',
    'inputs.pattern.SampleGrad(uv, ddx(uv), ddy(uv))',
    'inputs.pattern.Sample(inputs.pattern.sampler, uv)',
    'inputs.pattern.SampleLevel(inputs.pattern.sampler, uv, 0.0)',
    'inputs.pattern.SampleGrad(inputs.pattern.sampler, uv, ddx(uv), ddy(uv))',
    'inputs.pattern.texture.Sample(inputs.pattern.sampler, float2(uv.x, 1.0 - uv.y))',
  ])('preserves bottom-left image coordinates through %s', { timeout: 30_000 }, async (sample) => {
    const harness = createShaderCanvasHarness('slang');
    try {
      await harness.compile({
        image: `float4 mainImage(float2 c) { float2 uv = c / iResolution.xy; return ${sample}; }`,
        buffers: { Pattern: pattern },
        config: { version: '1', passes: {
          Image: { inputs: { pattern: { type: 'buffer', source: 'Pattern', filter: 'nearest' } } },
          Pattern: { path: 'pattern.slang', resolution: { width: 2, height: 2 } },
        } },
      });
      expect(await harness.renderAndReadPixels()).toEqual([
        [0, 255, 0, 255], [255, 255, 0, 255],
        [0, 0, 0, 255], [255, 0, 0, 255],
      ]);
    } finally {
      harness.dispose();
    }
  });

  it('uses an explicitly supplied sampler instead of the configured default', { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness('slang');
    try {
      const image = document.createElement('canvas');
      image.width = image.height = 2;
      const context = image.getContext('2d')!;
      context.putImageData(new ImageData(new Uint8ClampedArray([
        0, 255, 0, 255, 255, 255, 0, 255,
        0, 0, 0, 255, 255, 0, 0, 255,
      ]), 2, 2), 0, 0);
      const url = image.toDataURL();
      // A separate configured resource supplies the override sampler.
      context.fillStyle = 'white';
      context.fillRect(0, 0, 2, 2);
      const referenceUrl = image.toDataURL();
      await harness.compile({
        image: `float4 mainImage(float2 c) {
          float2 uv = float2(0.5, 0.5);
          float4 nearest = inputs.pattern.SampleLevel(uv, 0);
          float4 linear = inputs.pattern.SampleLevel(inputs.linear.sampler, uv, 0);
          return float4(abs(nearest.r - linear.r), linear.g, 0, 1);
        }`,
        config: { version: '1', passes: {
          Image: { inputs: {
            pattern: { type: 'texture', path: 'nearest.png', resolved_path: url, filter: 'nearest' },
            linear: { type: 'texture', path: 'linear.png', resolved_path: referenceUrl, filter: 'linear' },
          } },
        } },
      });
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(Math.abs(pixel[0] - 128)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[1] - 128)).toBeLessThanOrEqual(1);
        expect(pixel.slice(2)).toEqual([0, 255]);
      }
    } finally {
      harness.dispose();
    }
  });
});

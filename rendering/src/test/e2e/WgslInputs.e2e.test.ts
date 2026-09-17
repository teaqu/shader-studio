import { describe, expect, it } from 'vitest';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

const pattern = `fn mainImage(c: vec2f) -> vec4f {
  return vec4f(f32(c.x >= 1.0), f32(c.y >= 1.0), 0.0, 1.0);
}`;

describe('WGSL named inputs rendering', () => {
  it.each([
    'patternSample(uv)',
    'patternSampleLevel(uv, 0.0)',
    'patternSampleGrad(uv, dpdx(uv), dpdy(uv))',
    'sample2D(patternTexture, patternSampler, uv)',
    'textureSample(patternTexture, patternSampler, vec2f(uv.x, 1.0 - uv.y))',
  ])('preserves bottom-left image coordinates through %s', { timeout: 30_000 }, async (sample) => {
    const harness = createShaderCanvasHarness('wgsl');
    try {
      await harness.compile({
        image: `fn mainImage(c: vec2f) -> vec4f { let uv = c / iResolution.xy; return ${sample}; }`,
        buffers: { Pattern: pattern },
        config: { version: '1', passes: {
          Image: { inputs: { pattern: { type: 'buffer', source: 'Pattern', filter: 'nearest' } } },
          Pattern: { path: 'pattern.wgsl', resolution: { width: 2, height: 2 } },
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
    const harness = createShaderCanvasHarness('wgsl');
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
        image: `fn mainImage(c: vec2f) -> vec4f {
          let uv = vec2f(0.5, 0.5);
          let nearest = patternSampleLevel(uv, 0.0);
          let linear = sample2DLevel(patternTexture, linearSampler, uv, 0.0);
          return vec4f(abs(nearest.r - linear.r), linear.g, 0.0, 1.0);
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

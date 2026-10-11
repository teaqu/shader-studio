import { describe, expect, it } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { createShaderCanvasHarness, type ShaderLanguage } from './ShaderCanvasHarness';

const sources: Record<ShaderLanguage, string> = {
  glsl: 'void mainImage(out vec4 color, in vec2 coord) { color = vec4(abs(iWorldPosition) * 0.65 + vec3(0.08, 0.03, 0.12), 1.0); }',
  wgsl: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(abs(iWorldPosition) * 0.65 + vec3f(0.08, 0.03, 0.12), 1.0); }',
  slang: 'float4 mainImage(float2 coord) { return float4(abs(iWorldPosition) * 0.65 + float3(0.08, 0.03, 0.12), 1); }',
};
const config: ShaderConfig = { version: '1.0', passes: { Image: { geometry: { type: 'cube' } } } };

function orbit(canvas: HTMLCanvasElement): void {
  const capture = canvas.setPointerCapture;
  const release = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  try {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 44, clientX: 16, clientY: 16 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { button: 0, pointerId: 44, clientX: 78, clientY: 33 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 44, clientX: 78, clientY: 33 }));
  } finally {
    canvas.setPointerCapture = capture;
    canvas.releasePointerCapture = release;
  }
}

describe('3D camera shader sessions', () => {
  it.each(['glsl', 'wgsl', 'slang'] as const)('resets the %s camera on shader switches and preserves it on recompilation', { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language);
    const image = sources[language];
    try {
      harness.resize(96, 96);
      await harness.compile({ path: `/first.${language}`, image, config });
      const initial = await harness.renderAndReadRegion();
      expect(initial.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true);
      orbit(harness.canvas);
      const moved = await harness.renderAndReadRegion();
      expect(moved).not.toEqual(initial);
      await harness.compile({ path: `/first.${language}`, image: `${image}\n// edited`, config });
      expect(await harness.renderAndReadRegion()).toEqual(moved);
      const failed = await harness.engine.compileShaderPipeline('INVALID SHADER SOURCE', config, `/broken.${language}`, {});
      expect(failed?.success).toBe(false);
      await harness.compile({ path: `/first.${language}`, image, config });
      expect(await harness.renderAndReadRegion()).toEqual(moved);
      await harness.compile({ path: `/second.${language}`, image, config });
      expect(await harness.renderAndReadRegion()).toEqual(initial);
      orbit(harness.canvas);
      await harness.compile({ path: `/first.${language}`, image, config });
      expect(await harness.renderAndReadRegion()).toEqual(initial);
    } finally {
      harness.dispose();
    }
  });
});

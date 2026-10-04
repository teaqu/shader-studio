import { describe, expect, it } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

const source = {
  wgsl: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(abs(iWorldPosition) * 0.65 + vec3f(0.08), 1.0); }',
  slang: 'float4 mainImage(float2 coord) { return float4(abs(iWorldPosition) * 0.65 + float3(0.08), 1); }',
};
const native = {
  wgsl: `@vertex fn rawVertex(@location(0) p: vec3f) -> @builtin(position) vec4f { return vec4f(p, 1); }
@fragment fn rawColor() -> @location(0) vec4f { return vec4f(1, 0.2, 0.1, 1); }`,
  slang: `[shader("vertex")] float4 rawVertex(float3 p : POSITION) : SV_Position { return float4(p, 1); }
[shader("fragment")] float4 rawColor() : SV_Target0 { return float4(1, 0.2, 0.1, 1); }`,
};

function hasColor(pixels: Uint8ClampedArray): boolean {
  return pixels.some((value, index) => index % 4 !== 3 && value > 0);
}

describe('camera-disabled cube depth', () => {
  it.each(['wgsl', 'slang'] as const)('renders the unmodified %s cube after toggling viewer camera off and on', { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language);
    const path = `/camera-cube.${language}`;
    const image = source[language];
    try {
      harness.resize(64, 64);
      for (const useViewerCamera of [true, false, true, false]) {
        const config: ShaderConfig = { version: '1.0', passes: { Image: { geometry: { type: 'cube' }, useViewerCamera } } };
        await harness.compile({ path, image, config });
        expect(hasColor(await harness.renderAndReadRegion())).toBe(true);
      }
    } finally {
      harness.dispose();
    }
  });

  it.each(['wgsl', 'slang'] as const)('renders a native %s mesh that writes the far clip boundary with camera disabled', { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(64, 64);
      await harness.compile({ path: `/native-cube.${language}`, image: native[language], config: {
        version: '1.0', passes: { Image: { geometry: { type: 'cube' }, useViewerCamera: false, entryPoints: { vertex: 'rawVertex', fragment: 'rawColor' } } },
      } });
      expect(hasColor(await harness.renderAndReadRegion())).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});

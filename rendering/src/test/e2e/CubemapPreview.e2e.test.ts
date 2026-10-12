import { describe, expect, it } from 'vitest';
import { createCubemapPreview } from '../../../../ui/src/lib/cubemapPreview';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

const config = { version: '1', passes: { Image: {}, Cube: { path: 'cube.source', outputKind: 'cubemap' as const, faceSize: 16 } } };
const glslCube = `void mainCubemap(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) { color = vec4(direction.x > abs(direction.y) && direction.x > abs(direction.z) ? 1.0 : 0.0, 0.0, 0.0, 1.0); }`;
const slangCube = `float4 mainCubemap(float2 coord, float3 origin, float3 direction) { return float4(direction.x > abs(direction.y) && direction.x > abs(direction.z) ? 1.0 : 0.0, 0.0, 0.0, 1.0); }`;

describe('generated cubemap previews', () => {
  it.each([
    ['glsl', glslCube],
    ['slang', slangCube],
  ] as const)('renders a selected +X face through the %s cube binding', { timeout: 30_000 }, async (language, cube) => {
    const harness = createShaderCanvasHarness(language);
    try {
      const preview = createCubemapPreview({ config, passName: 'Cube', language, mode: 'face', face: 'positive-x' });
      expect(preview).not.toBeNull();
      await harness.compile({ image: preview!.code, config: preview!.config, buffers: { Cube: cube } });
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual([255, 0, 0, 255]);
      }
    } finally {
      harness.dispose();
    }
  });
});

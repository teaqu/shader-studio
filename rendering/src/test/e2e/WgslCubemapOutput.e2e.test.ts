import { describe, expect, it } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

const image = `fn mainImage(p: vec2f) -> vec4f {
 let rays = array<vec3f, 4>(vec3f(1,0,0), vec3f(-1,0,0), vec3f(0,1,0), vec3f(0,-1,0));
 return skySampleLevel(rays[u32(p.x) + 2u*u32(p.y)], 0.0);
}`;
const config: ShaderConfig = { version: '1.0', passes: {
  Image: { inputs: { sky: { type: 'buffer', source: 'Sky', filter: 'nearest' } } },
  Sky: { path: 'sky.wgsl', outputKind: 'cubemap', faceSize: 16 },
} };

describe('WGSL generated cubemaps', () => {
  it('renders and samples the cube axes', async () => {
    const harness = createShaderCanvasHarness('wgsl');
    try {
      harness.resize(2,2);
      await harness.compile({ image, config, buffers: { Sky: 'fn mainCubemap(p: vec2f, o: vec3f, d: vec3f) -> vec4f { return vec4f(select(0.0,1.0,d.x > 0.99),select(0.0,1.0,d.y > 0.99),select(0.0,1.0,d.z > 0.99),1.0); }' } });
      expect(await harness.renderAndReadPixels()).toEqual([[0,255,0,255],[0,0,0,255],[255,0,0,255],[0,0,0,255]]);
    } finally {
      harness.dispose(); 
    }
  });
  it('reads prior cube feedback and clears it when face size changes', async () => {
    const harness = createShaderCanvasHarness('wgsl');
    const feedbackConfig: ShaderConfig = { ...config, passes: { ...config.passes, Sky: { ...config.passes.Sky!, inputs: { history: { type: 'buffer', source: 'Sky' } } } } };
    const buffers = { Sky: 'fn mainCubemap(p: vec2f, o: vec3f, d: vec3f) -> vec4f { return historySampleLevel(d,0.0)+vec4f(0.1,0,0,1); }' };
    try {
      harness.resize(2,2);
      await harness.compile({ image, config: feedbackConfig, buffers });
      expect((await harness.renderAndReadPixels()).map(pixel => pixel[0])).toEqual([26,26,26,26]);
      expect((await harness.renderAndReadPixels()).map(pixel => pixel[0])).toEqual([51,51,51,51]);
      await harness.compile({ image, buffers, config: { ...feedbackConfig, passes: { ...feedbackConfig.passes, Sky: { ...feedbackConfig.passes.Sky!, faceSize: 32 } } } });
      expect((await harness.renderAndReadPixels()).map(pixel => pixel[0])).toEqual([26,26,26,26]);
    } finally {
      harness.dispose(); 
    }
  });
});

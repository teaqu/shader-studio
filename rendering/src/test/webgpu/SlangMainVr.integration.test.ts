// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SlangCompiler } from '../../webgpu/SlangCompiler';
import { createShaderToyUniformLayout } from '../../webgpu/SlangPrelude';
import type { SlangModuleApi } from '../../webgpu/slangTypes';

let compiler: SlangCompiler;
beforeAll(async () => {
  const url = new URL('../../../../ui/src/slang/slang-wasm.js', import.meta.url);
  const runtime = await import(/* @vite-ignore */ url.href) as { default: () => Promise<SlangModuleApi> };
  compiler = new SlangCompiler(await runtime.default());
}, 30_000);

afterAll(() => compiler?.dispose());

const IMAGE = 'float4 mainImage(float2 c) { return float4(1, 0, 0, 1); }';
const VR = 'float4 mainVR(float2 c, float3 origin, float3 direction) { return float4(direction * 0.5 + 0.5, length(origin)); }';

describe('Slang mainVR compiles to WGSL', () => {
  it('dispatches the fullscreen Image fragment to mainVR and mainImage', () => {
    const result = compiler.compileImagePass(`${IMAGE}\n${VR}`, { passName: 'Image' });
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) {
      expect(result.wgsl).toMatch(/fn mainVR_\w*\(/);
      expect(result.wgsl).toMatch(/fn mainImage_\w*\(/);
    }
  });

  it('compiles mainVR from Common with a vertex hook', () => {
    const result = compiler.compileImagePass(IMAGE, {
      passName: 'Image',
      commonCode: VR,
      vertexCode: 'void mainVertex(uint i, inout float3 p, inout float3 n, inout float2 uv) {}',
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('exposes every controller input to buffer passes', () => {
    const result = compiler.compileImagePass(`float4 mainImage(float2 c) {
      float4 v = iVRControllerPosition[0] + iVRControllerDirection[1] + iVRControllerButtons[0] + iVRControllerAxes[1]
        + iVRControllerFaceButtons[0] + iVRControllerTouches[1] + iVRControllerFaceTouches[0];
      return iVRActive ? v : float4(0);
    }`, { passName: 'BufferA' });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('lays out the VR block at the offsets the uniform packer writes', () => {
    const result = compiler.compileImagePass(`float4 mainImage(float2 c) {
      return float4(_st.vrState) + _st.vrViewport + mul(_st.vrRayTransform, float4(c, 0, 1)) + iVRControllerFaceTouches[1] + float4(iTime);
    }`, { passName: 'BufferA' });
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) {
      return;
    }
    // Walk Slang's own @align annotations so the test checks the compiler's layout, not ours.
    const body = /struct ShaderToyUniforms_std140_\w*\s*\{([^}]*)\}/.exec(result.wgsl)?.[1];
    expect(body).toBeDefined();
    const sizes: Record<string, number> = { 'vec4<f32>': 16, 'vec4<i32>': 16, 'vec4<u32>': 16, 'vec2<f32>': 8, f32: 4, i32: 4, 'array<vec4<f32>, i32(2)>': 32 };
    const sizeOf = (type: string) => sizes[type] ?? (type.startsWith('ShaderStudioPointer') ? 48 : 64);
    const fieldOffsets = new Map<string, number>();
    let cursor = 0;
    for (const match of body!.matchAll(/@align\((\d+)\)\s*(\w+)_\d+\s*:\s*(.+),\s*$/gm)) {
      const align = Number(match[1]);
      cursor = Math.ceil(cursor / align) * align;
      fieldOffsets.set(match[2]!, cursor);
      cursor += sizeOf(match[3]!.trim());
    }
    const offset = (name: string) => fieldOffsets.get(name);
    const { offsets } = createShaderToyUniformLayout(4);
    expect(offset('vrState')).toBe(offsets.iVrState);
    expect(offset('vrViewport')).toBe(offsets.iVrViewport);
    expect(offset('vrRayTransform')).toBe(offsets.iVrRayTransform);
    expect(offset('vrControllerPosition')).toBe(offsets.iVrControllers);
    expect(offset('vrControllerFaceTouches')).toBe(offsets.iVrControllers + 6 * 32);
    expect(offset('pointer')).toBe(offsets.iPointer);
    expect(cursor).toBe(createShaderToyUniformLayout(4).size);
  });
});

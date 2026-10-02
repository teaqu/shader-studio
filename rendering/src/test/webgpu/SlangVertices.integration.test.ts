// @vitest-environment node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

const bundledSlangModuleUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url);
const hasBundledSlangWasm = existsSync(fileURLToPath(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url)));

const image = "float4 mainImage(float2 c) { return float4(c / iResolution.xy, float(iVertexCount), 1); }";
const hook = `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  float a = 6.2831853 * float(vertexIndex) / float(iVertexCount);
  position = float3(cos(a), sin(a), 0);
}`;

// Real slang-wasm compiles: each takes seconds, so the suite gets a long timeout.
describe.runIf(hasBundledSlangWasm)("Slang vertices geometry with bundled slang-wasm", { timeout: 30_000 }, () => {
  let compiler: SlangCompiler;

  beforeAll(async () => {
    const runtime = await import(/* @vite-ignore */ bundledSlangModuleUrl.href) as { default: () => Promise<SlangModuleApi> };
    compiler = new SlangCompiler(await runtime.default());
  }, 30_000);

  afterAll(() => compiler?.dispose());

  it.each(["world", "clip"] as const)("compiles a %s-space hook with no vertex inputs", (vertexSpace) => {
    const result = compiler.compileImagePass(image, { geometry: "vertices", vertexSpace, vertexCode: hook });

    expect(result.success, JSON.stringify(result)).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("@builtin(vertex_index)");
    expect(result.wgsl).not.toMatch(/@location\(0\)\s+\w+\s*:\s*vec3<f32>\s*,\s*@location\(1\)/);
    if (vertexSpace === "world") {
      expect(result.wgsl).toContain("viewProjection");
    } else {
      expect(result.wgsl).not.toContain("viewProjection");
    }
  });

  it.each(["world", "clip"] as const)("compiles the generated no-op hook in %s space", (vertexSpace) => {
    const result = compiler.compileImagePass(image, { geometry: "vertices", vertexSpace });

    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  describe("instancing", () => {
    const instancedImage = "float4 mainImage(float2 c) { return float4(float(iInstanceIndex) / float(iInstanceCount), 0, 0, 1); }";
    const instancedHook = `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  position.x += float(iInstanceIndex) / float(iInstanceCount);
}`;

    it.each([
      ["world vertices", { geometry: "vertices", vertexSpace: "world" }],
      ["clip vertices", { geometry: "vertices", vertexSpace: "clip" }],
      ["cube", { geometry: "cube" }],
    ] as const)("passes the instance index flat to %s fragments", (_label, options) => {
      const result = compiler.compileImagePass(instancedImage, { ...options, vertexCode: instancedHook });

      expect(result.success, JSON.stringify(result)).toBe(true);
      if (!result.success) {
        return;
      }
      expect(result.wgsl).toContain("@builtin(instance_index)");
      expect(result.wgsl).toMatch(/@interpolate\(flat\)/);
    });

    it("compiles fullscreen shaders that read the instance built-ins without an instance input", () => {
      const result = compiler.compileImagePass(instancedImage, { vertexCode: instancedHook });

      expect(result.success, JSON.stringify(result)).toBe(true);
      if (!result.success) {
        return;
      }
      expect(result.wgsl).not.toContain("@builtin(instance_index)");
    });
  });
});

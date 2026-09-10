import { describe, expect, it } from "vitest";
import { WgslCompiler } from "../../webgpu/WgslCompiler";
import type { SlangCompileOptions } from "../../webgpu/SlangCompiler";

const IMAGE = "fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(iTime); }";
const COMPUTE = "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) {\n  writeOutput(id.xy, vec4<f32>(1.0));\n}";

describe("WgslCompiler", () => {
  it("passes image source through the WGSL wrapper with a line offset", async () => {
    const compiler = new WgslCompiler();
    const result = await compiler.compile(IMAGE, { passKind: "render" });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("fn mainImage(coord: vec2<f32>) -> vec4<f32>");
    expect(result.wgsl).toContain("fn _ss_initGlobals()");
    expect(result.sourceLineOffset).toBeGreaterThan(0);
    expect(result.requiredFeatures).toEqual([]);
    compiler.dispose();
  });

  it("passes compute source through with dispatch and output preludes", async () => {
    const compiler = new WgslCompiler();
    const options: SlangCompileOptions = {
      passKind: "compute",
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: true,
    };
    const result = await compiler.compile(COMPUTE, options);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("_ss_initGlobals();");
    expect(result.wgsl).toContain("texture_storage_2d<rgba16float, write>");
    expect(result.sourceLineOffset).toBeGreaterThan(0);
    compiler.dispose();
  });

  it("never rejects: user errors stay in the module for the browser compiler", async () => {
    const compiler = new WgslCompiler();
    const result = await compiler.compile("fn broken( {", { passKind: "render" });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("fn broken( {");
    compiler.dispose();
  });

  it("concatenates imported module sources as common code", async () => {
    const compiler = new WgslCompiler();
    const result = await compiler.compile(IMAGE, {
      passKind: "render",
      modules: [{ moduleName: "helpers", path: "/helpers.wgsl", source: "fn helper() -> f32 { return 1.0; }" }],
      commonCode: "fn commonFn() -> f32 { return 3.0; }",
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("fn helper() -> f32 { return 1.0; }");
    expect(result.wgsl).toContain("fn commonFn() -> f32 { return 3.0; }");
    compiler.dispose();
  });

  it("forwards the vertex hook to the wrapper", async () => {
    const compiler = new WgslCompiler();
    const vertexCode = "fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) { *uv = *uv * 2.0; }";
    const result = await compiler.compile(IMAGE, { passKind: "render", vertexCode });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("*uv = *uv * 2.0;");
    expect(result.wgsl).toContain("mainVertex(&position, &normal, &uv)");
    compiler.dispose();
  });

  it("forwards channels, storage, and custom uniforms to the wrapper", async () => {
    const compiler = new WgslCompiler();
    const result = await compiler.compile(IMAGE, {
      passKind: "render",
      channels: [{ slot: 0, key: "iChannel0", kind: "texture", textureIdentity: "t", samplerIdentity: "s" }],
      storage: [{ name: "buf", binding: 0, elementType: "float4", builtin: true, count: 8, stride: 16 }],
      customUniforms: [{ name: "gain", type: "float" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.wgsl).toContain("_ss_iChannel0_tex");
    expect(result.wgsl).toContain("var<storage, read> buf");
    expect(result.wgsl).toContain("custom_gain");
    compiler.dispose();
  });
});

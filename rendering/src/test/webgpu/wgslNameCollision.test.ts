import { describe, expect, it } from "vitest";
import type { SlangChannelBinding } from "../../webgpu/SlangPrelude";
import { wrapWgslComputeSource, wrapWgslImageSource } from "../../webgpu/WgslPrelude";

const IMAGE = "fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(iTime); }";

const CHANNEL: SlangChannelBinding = {
  key: "iChannel0",
  kind: "texture",
  slot: 0,
  textureBinding: 1,
  samplerBinding: 2,
} as SlangChannelBinding;

describe("wgsl prelude name collision guarding", () => {
  it("prefixes channel texture/sampler variables with _ss_", () => {
    const { source } = wrapWgslImageSource(IMAGE, { channels: [CHANNEL] });

    expect(source).not.toMatch(/(?<!_ss_)iChannel0_tex/);
    expect(source).not.toMatch(/(?<!_ss_)iChannel0_smp/);
    expect(source).toContain("_ss_iChannel0_tex");
    expect(source).toContain("_ss_iChannel0_smp");
  });

  it("prefixes the compute output texture with _ss_", () => {
    const compute = "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) {\n  writeOutput(id.xy, vec4<f32>(1.0));\n}";
    const { source } = wrapWgslComputeSource(compute, {
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: true,
    });

    expect(source).not.toMatch(/var _outTex:/);
    expect(source).toContain("_ss_outTex");
  });

  it("prefixes the mesh uniforms variable with _ss_", () => {
    const { source } = wrapWgslImageSource(IMAGE, {
      geometry: "mesh",
      vertexCode: "fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {}",
    });

    expect(source).not.toMatch(/var<uniform> _mesh:/);
    expect(source).toContain("_ss_mesh");
  });

  it("prefixes internal struct types with _ss_", () => {
    const { source } = wrapWgslImageSource(IMAGE);

    expect(source).not.toContain("struct ShaderToyUniforms");
    expect(source).toContain("struct _ss_ShaderToyUniforms");
  });

  it("prefixes the capture variable index with _ss_", () => {
    const { source } = wrapWgslImageSource(IMAGE, { captureMode: true });

    expect(source).not.toMatch(/var<private> _dbgVarIndex/);
    expect(source).toContain("var<private> _ss_dbgVarIndex: i32;");
  });

  it("keeps the deliberate public API unprefixed", () => {
    const { source } = wrapWgslImageSource(IMAGE, { channels: [CHANNEL] });

    for (const name of [
      "fn mainImage",
      "iResolution",
      "iChannel0Sample",
      "vertexMain",
      "fragmentMain",
    ]) {
      expect(source).toContain(name);
    }
  });
});

import { describe, expect, it } from "vitest";
import { wrapSlangComputeSource, wrapSlangImageSource } from "../../webgpu/SlangPrelude";
import { wrapWgslComputeSource, wrapWgslImageSource } from "../../webgpu/WgslPrelude";

const WGSL_IMAGE = "fn mainImage(c: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }";
const WGSL_VR = "fn mainVR(c: vec2f, o: vec3f, d: vec3f) -> vec4f { return vec4f(d, 1.0); }";
const SLANG_IMAGE = "float4 mainImage(float2 c) { return float4(1, 0, 0, 1); }";
const SLANG_VR = "float4 mainVR(float2 c, float3 o, float3 d) { return float4(d, 1); }";

describe("WGSL mainVR wrapping", () => {
  it("routes the fullscreen Image fragment through the VR helper", () => {
    const { source } = wrapWgslImageSource(`${WGSL_IMAGE}\n${WGSL_VR}`, { passName: "Image" });
    expect(source).toContain("return _ss_vrImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y));");
    expect(source).toContain("fn _ss_vrImage(coord: vec2<f32>) -> vec4<f32> {");
    expect(source).not.toMatch(/return mainImage\(vec2<f32>\(fragCoord/);
  });

  it("routes a fullscreen Image with a vertex hook through the VR helper", () => {
    const hook = "fn mainVertex(i: u32, p: ptr<function, vec3f>, n: ptr<function, vec3f>, uv: ptr<function, vec2f>) {}";
    const { source } = wrapWgslImageSource(`${WGSL_IMAGE}\n${WGSL_VR}`, { passName: "Image", vertexCode: hook });
    expect(source).toContain("return _ss_vrImage(vec2<f32>(fragCoord.x, _ss_u.resolution.y - fragCoord.y));");
    expect(source.match(/fn _ss_vrImage/g)).toHaveLength(1);
  });

  it("detects mainVR defined in Common", () => {
    const { source } = wrapWgslImageSource(WGSL_IMAGE, { passName: "Image", commonCode: WGSL_VR });
    expect(source).toContain("fn _ss_vrImage(");
  });

  it.each([
    ["a buffer pass", { passName: "BufferA" }],
    ["mesh geometry", { passName: "Image", geometry: "cube" as const }],
    ["clip-space vertices", { passName: "Image", geometry: "vertices" as const, vertexSpace: "clip" as const }],
    ["variable capture", { passName: "Image", captureMode: true }],
    ["a native fragment", { passName: "Image", renderEntryPoints: { fragment: "fs" } }],
  ])("keeps mainImage for %s", (_label, options) => {
    const native = "@fragment fn fs() -> @location(0) vec4f { return vec4f(1); }";
    const { source } = wrapWgslImageSource(`${WGSL_IMAGE}\n${WGSL_VR}\n${native}`, options);
    expect(source).not.toContain("_ss_vrImage");
  });

  it("appends the VR block to the uniform struct for every pass", () => {
    const { source } = wrapWgslImageSource(WGSL_IMAGE, { passName: "BufferA" });
    expect(source).toMatch(/pointer: ShaderStudioPointer,\n {2}vrState: vec4<i32>,\n {2}vrViewport: vec4<f32>,\n {2}vrRayTransform: mat4x4<f32>,/);
    expect(source).toContain("vrControllerFaceTouches: array<vec4<f32>, 2>,");
  });

  it("declares controller globals only when the source references them", () => {
    expect(wrapWgslImageSource(WGSL_IMAGE, { passName: "Image" }).source).not.toContain("var<private> iVRActive");
    const used = wrapWgslImageSource("fn mainImage(c: vec2f) -> vec4f { return select(vec4f(0), iVRControllerButtons[1], iVRActive); }", { passName: "BufferA" }).source;
    expect(used).toContain("var<private> iVRActive: bool;");
    expect(used).toContain("  iVRControllerButtons = _ss_u.vrControllerButtons;");
    const common = wrapWgslImageSource(WGSL_IMAGE, { passName: "Image", commonCode: "fn grip() -> f32 { return iVRControllerButtons[0].y; }" }).source;
    expect(common).toContain("var<private> iVRControllerButtons: array<vec4<f32>, 2>;");
  });

  it("declares controller globals for compute passes that reference them", () => {
    const compute = "@compute @workgroup_size(1) fn main() { let t = iVRControllerAxes[0]; }";
    const options = { passName: "BufferA", workgroupSize: [1, 1, 1] as [number, number, number], outputLayers: 1, hasOutput: false };
    expect(wrapWgslComputeSource(compute, options).source).toContain("  iVRControllerAxes = _ss_u.vrControllerAxes;");
    expect(wrapWgslComputeSource("@compute @workgroup_size(1) fn main() {}", options).source).not.toContain("iVRControllerAxes");
  });
});

describe("Slang mainVR wrapping", () => {
  it("routes the default fullscreen Image fragment through the VR helper", () => {
    const source = wrapSlangImageSource(`${SLANG_IMAGE}\n${SLANG_VR}`, { passName: "Image" });
    expect(source).toContain("return _ss_vrImage(coord);");
    expect(source).toContain("float4 _ss_vrImage(float2 coord)");
  });

  it("routes a fullscreen Image with a vertex hook through the VR helper", () => {
    const hook = "void mainVertex(uint i, inout float3 p, inout float3 n, inout float2 uv) {}";
    const source = wrapSlangImageSource(`${SLANG_IMAGE}\n${SLANG_VR}`, { passName: "Image", vertexCode: hook });
    expect(source).toContain("return _ss_vrImage(float2(input.position.x, _st.resolution.y - input.position.y));");
    expect(source.match(/float4 _ss_vrImage/g)).toHaveLength(1);
  });

  it("detects mainVR defined in Common", () => {
    expect(wrapSlangImageSource(SLANG_IMAGE, { passName: "Image", commonCode: SLANG_VR })).toContain("_ss_vrImage");
  });

  it.each([
    ["a buffer pass", { passName: "BufferA" }],
    ["mesh geometry", { passName: "Image", geometry: "sphere" as const }],
    ["world-space vertices", { passName: "Image", geometry: "vertices" as const }],
    ["variable capture", { passName: "Image", captureMode: true }],
    ["a cubemap output", { passName: "Image", outputKind: "cubemap" as const }],
    ["a native fragment", { passName: "Image", renderEntryPoints: { fragment: "fs" } }],
  ])("keeps mainImage for %s", (_label, options) => {
    const native = "[shader(\"fragment\")] float4 fs() : SV_Target { return 1; }";
    expect(wrapSlangImageSource(`${SLANG_IMAGE}\n${SLANG_VR}\n${native}`, options)).not.toContain("_ss_vrImage");
  });

  it("declares the VR block and controller aliases in render and compute modules", () => {
    const image = wrapSlangImageSource(SLANG_IMAGE, { passName: "BufferA" });
    const compute = wrapSlangComputeSource("[shader(\"compute\")] [numthreads(1, 1, 1)] void main() {}", {
      passName: "BufferA", workgroupSize: [1, 1, 1], outputLayers: 1, hasOutput: false,
    });
    for (const source of [image, compute]) {
      expect(source).toMatch(/ShaderStudioPointer pointer;\n {4}int4 vrState;\n {4}float4 vrViewport;\n {4}column_major float4x4 vrRayTransform;\n {4}float4 vrControllerPosition\[2\];/);
      expect(source).toContain("#define iVRActive (_st.vrState.z != 0)");
      expect(source).toContain("#define iVRControllerFaceTouches (_st.vrControllerFaceTouches)");
    }
  });
});

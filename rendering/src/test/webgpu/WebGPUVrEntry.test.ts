import { describe, expect, it } from "vitest";
import {
  hasWebGpuMainVr,
  referencesWebGpuVrInputs,
  SLANG_VR_IMAGE_FUNCTION,
  usesWebGpuVrEntry,
  webGpuImageCall,
  wgslVrGlobals,
  wgslVrUniformFields,
  WGSL_VR_IMAGE_FUNCTION,
} from "../../webgpu/WebGPUVrEntry";

const WGSL_VR = "fn mainVR(coord: vec2<f32>, origin: vec3<f32>, direction: vec3<f32>) -> vec4<f32> { return vec4f(direction, 1.0); }";
const SLANG_VR = "float4 mainVR(float2 coord, float3 origin, float3 direction) { return float4(direction, 1); }";

describe("hasWebGpuMainVr", () => {
  it.each([
    ["WGSL", WGSL_VR],
    ["Slang", SLANG_VR],
    ["WGSL with shorthand types", "fn mainVR(c: vec2f, o: vec3f, d: vec3f) -> vec4f {\n  return vec4f(1);\n}"],
    ["Slang split across lines", "float4\nmainVR(\n  float2 c,\n  float3 o,\n  float3 d)\n{\n  return 1;\n}"],
  ])("detects a %s definition", (_label, source) => {
    expect(hasWebGpuMainVr(source)).toBe(true);
  });

  it.each([
    ["no mainVR", "fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }"],
    ["a call only", "fn mainImage(c: vec2f) -> vec4f { return mainVR(c, vec3f(0), vec3f(0, 0, -1)); }"],
    ["a Slang declaration without a body", "float4 mainVR(float2 c, float3 o, float3 d);"],
    ["a line comment", `// ${WGSL_VR}`],
    ["a block comment", `/* ${SLANG_VR} */`],
    ["a longer identifier", "fn mainVRScene(c: vec2f) -> vec4f { return vec4f(1); }"],
  ])("ignores %s", (_label, source) => {
    expect(hasWebGpuMainVr(source)).toBe(false);
  });
});

describe("usesWebGpuVrEntry", () => {
  const image = { passName: "Image" } as const;

  it("wraps the fullscreen Image hook when mainVR is defined", () => {
    expect(usesWebGpuVrEntry(image, WGSL_VR)).toBe(true);
    expect(usesWebGpuVrEntry({ ...image, passKind: "render", geometry: "fullscreen", outputKind: "2d", captureMode: false, renderEntryPoints: {} }, SLANG_VR)).toBe(true);
  });

  it.each([
    ["a buffer pass", { passName: "BufferA" }],
    ["an unnamed pass", {}],
    ["a compute pass", { ...image, passKind: "compute" as const }],
    ["mesh geometry", { ...image, geometry: "sphere" as const }],
    ["vertices geometry", { ...image, geometry: "vertices" as const }],
    ["a cubemap output", { ...image, outputKind: "cubemap" as const }],
    ["variable capture", { ...image, captureMode: true }],
    ["a native vertex stage", { ...image, renderEntryPoints: { vertex: "vs" } }],
    ["a native fragment stage", { ...image, renderEntryPoints: { fragment: "fs" } }],
  ])("keeps mainImage for %s", (_label, pass) => {
    expect(usesWebGpuVrEntry(pass, WGSL_VR)).toBe(false);
  });

  it("keeps mainImage without a mainVR definition", () => {
    expect(usesWebGpuVrEntry(image, "fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }")).toBe(false);
  });
});

describe("generated VR source", () => {
  it("routes the fullscreen call through the VR helper only when requested", () => {
    expect(webGpuImageCall(false, "coord")).toBe("mainImage(coord)");
    expect(webGpuImageCall(true, "coord")).toBe("_ss_vrImage(coord)");
  });

  it("detects referenced controller inputs, ignoring comments and longer names", () => {
    expect(referencesWebGpuVrInputs("let on = iVRActive;")).toBe(true);
    for (const name of ["Position", "Direction", "Buttons", "Axes", "FaceButtons", "Touches", "FaceTouches"]) {
      expect(referencesWebGpuVrInputs(`let v = iVRController${name}[0];`)).toBe(true);
    }
    expect(referencesWebGpuVrInputs("// iVRActive")).toBe(false);
    expect(referencesWebGpuVrInputs("let iVRActiveLocal = 1;")).toBe(false);
    expect(referencesWebGpuVrInputs("let x = iVRControllerGrip;")).toBe(false);
  });

  it("declares uniform fields in createShaderToyUniformLayout order", () => {
    expect(wgslVrUniformFields().split("\n").map(line => line.trim().split(":")[0])).toEqual([
      "vrState", "vrViewport", "vrRayTransform",
      "vrControllerPosition", "vrControllerDirection", "vrControllerButtons", "vrControllerAxes",
      "vrControllerFaceButtons", "vrControllerTouches", "vrControllerFaceTouches",
    ]);
  });

  it("initialises every WGSL controller global from its uniform field", () => {
    const { declarations, initialisers } = wgslVrGlobals();
    expect(declarations).toContain("var<private> iVRActive: bool;");
    expect(declarations).toContain("var<private> iVRControllerFaceTouches: array<vec4<f32>, 2>;");
    expect(initialisers).toContain("  iVRActive = _ss_u.vrState.z != 0;");
    expect(initialisers).toContain("  iVRControllerAxes = _ss_u.vrControllerAxes;");
    expect(declarations).toHaveLength(8);
    expect(initialisers).toHaveLength(8);
  });

  it.each([
    ["WGSL", WGSL_VR_IMAGE_FUNCTION],
    ["Slang", SLANG_VR_IMAGE_FUNCTION],
  ])("checks immersive eyes before the desktop preview flag in %s", (_label, source) => {
    const immersive = source.indexOf("vrState.y");
    const preview = source.indexOf("vrState.x");
    expect(immersive).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(immersive);
    expect(source).toContain("mainImage(coord)");
    expect(source.match(/mainVR\(/g)).toHaveLength(2);
  });
});

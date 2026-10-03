import { describe, expect, it } from "vitest";
import type { DebugAnalysisRequest } from "@shader-studio/types";
import { WgslDebugEngine } from "../wgsl/WgslDebugEngine";
import { SlangDebugEngine } from "../slang/SlangDebugEngine";
import { buildNativeRasterReplay } from "./NativeRasterReplay";

function request(source: string, language: "wgsl" | "slang", entryPoint: string, line: number): DebugAnalysisRequest {
  const path = `/work/native.${language}`;
  return { workspace: { rootUri: path, rootPath: path, passName: "Image", render: { entryPoint }, contentHash: "abcd1234",
    files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }] },
  sourceUri: path, position: { line, character: 2 } };
}

describe("selected native fragment debugging", () => {
  it.each(["wgsl", "slang"] as const)("captures and previews the selected %s fragment", language => {
    const stageSource = language === "wgsl"
      ? "@fragment fn unused() -> @location(0) vec4f { return vec4f(0); }\n@fragment fn image(@builtin(position) p: vec4f) -> @location(0) vec4f {\n  let value = p.x;\n  return vec4f(value);\n}"
      : '[shader("fragment")] float4 unused() : SV_Target { return float4(0); }\n[shader("fragment")] float4 image(float4 p : SV_Position) : SV_Target {\n  float value = p.x;\n  return float4(value);\n}';
    const legacy = language === "wgsl" ? "fn mainImage(p: vec2f) -> vec4f { return vec4f(p,0,1); }" : "float4 mainImage(float2 p) { return float4(p,0,1); }";
    const source = stageSource + "\n" + legacy;
    const input = request(source, language, "image", 2);
    const engine = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
    const analyzed = engine.analyze(input);

    if (!analyzed.ok) {
      throw new Error(analyzed.diagnostics[0]?.message);
    }
    const value = analyzed.analysis.visibleValues.find(v => v.name === "value")!;
    for (const result of [engine.planCapture(input, [value.id]), engine.planPreview(input, { normalizeMode: "off", stepEdge: null })]) {

      if (!result.ok) {
        throw new Error(result.diagnostics[0]?.message);
      }
      const rewritten = result.plan.files[0]!.source;
      expect(result.plan.nativeRender).toEqual({ fragmentEntryPoint: "image" });
      expect(rewritten).toContain("_ssdbg_abcd1234_userMain");
      expect(rewritten).toContain(language === "wgsl" ? "@builtin(position) p" : "p : SV_Position");
      expect(rewritten).toContain("_slot1 = value");
      expect(rewritten).toContain("mainImage(");
    }
  });

  it("preserves varying-dependent fragments for raster replay", () => {
    const input = request("@fragment fn image(@location(0) uv: vec2f) -> @location(0) vec4f {\n  let value = uv.x;\n  return vec4f(value);\n}", "wgsl", "image", 1);
    const result = new WgslDebugEngine().planPreview(input, { normalizeMode: "off", stepEdge: null });
    expect(result).toMatchObject({ ok: true, plan: { nativeRender: { fragmentEntryPoint: "image" } } });
  });

  it.each(["wgsl", "slang"] as const)("keeps GPU-authored %s fragment parameters instead of inspector defaults", language => {
    const source = language === "wgsl"
      ? "struct Inputs { @location(0) uv: vec2f, }\n@fragment fn image(input: Inputs) -> @location(0) vec4f {\n  let value = input.uv.x;\n  return vec4f(value);\n}"
      : 'struct Inputs { float2 uv : TEXCOORD0; };\n[shader("fragment")] float4 image(Inputs input) : SV_Target0 {\n  float value = input.uv.x;\n  return float4(value);\n}';
    const input = request(source, language, "image", 2);
    const debug = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
    const result = debug.planPreview(input, { normalizeMode: "off", stepEdge: null, customParameters: new Map([[0, "Inputs(0)"]]) });
    if (!result.ok) {
      throw new Error(result.diagnostics[0]?.message);
    }
    expect(result.plan.files[0]!.source).not.toContain("Inputs(0)");
    expect(result.plan.files[0]!.source).toContain("_userMain(input)");
  });

  it.each(["wgsl", "slang"] as const)("supports execution-marker-only native %s captures", language => {
    const source = language === "wgsl"
      ? "@fragment fn image() -> @location(0) vec4f {\n  return vec4f(1);\n}"
      : '[shader("fragment")] float4 image() : SV_Target0 {\n  return float4(1);\n}';
    const engine = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
    const result = engine.planCapture(request(source, language, "image", 1), []);
    expect(result).toMatchObject({ ok: true, plan: { captureSlots: [{ hidden: true }] } });
  });

  it("honors the selected Slang compute entry even when another entry and mainImage precede it", () => {
    const source = 'float4 mainImage(float2 p) { return float4(0); }\n[shader("compute")] [numthreads(1,1,1)] void first(uint3 id : SV_DispatchThreadID) {}\n[shader("compute")] [numthreads(1,1,1)] void second(uint3 id : SV_DispatchThreadID) {\n  float value = float(id.x);\n}';
    const input = request(source, "slang", "unused", 3);
    delete input.workspace.render;
    input.workspace.compute = { entryPoint: "second" };
    const result = new SlangDebugEngine().planPreview(input, { normalizeMode: "off", stepEdge: null });

    if (!result.ok) {
      throw new Error(result.diagnostics[0]?.message);
    }
    expect(result.plan.files[0]!.source).toContain("void _ssdbg_abcd1234_userMain(uint3 id)");
    expect(result.plan.files[0]!.source).toContain("void first(");
  });
});

describe("native MRT output selection", () => {
  it("replays WGSL attachment one while preserving the structured result", () => {
    const source = `struct Out { @location(0) first: vec4f, @location(1) second: vec4f, }\n@fragment fn image() -> Out { return Out(vec4f(0), vec4f(1)); }`;
    const replay = buildNativeRasterReplay(source, "wgsl", "image", "_debug", 1);
    expect(typeof replay).not.toBe("string");
    if (typeof replay !== "string") {
      expect(replay.returnColor("result", "vec4f(0.5)")).toContain("result.second");
    }
  });
  it("reports an invalid Slang MRT attachment", () => {
    const source = `struct Out { float4 first : SV_Target0; };\n[shader("fragment")] Out image() { Out o; return o; }`;
    expect(buildNativeRasterReplay(source, "slang", "image", "_debug", 1)).toContain("selected location");
  });
});

it("records selected MRT output four in a native WGSL capture plan", () => {
  const source = `struct Out { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f, @location(3) d: vec4f, @location(4) e: vec4f, }\n@fragment fn image() -> Out { let value = vec4f(1); return Out(value,value,value,value,value); }`;
  const path = "/work/native-five.wgsl";
  const workspace: DebugWorkspace = { rootUri: path, rootPath: path, passName: "BufferA", render: { entryPoint: "image", output: 4 }, contentHash: "five", files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "BufferA" }] };
  const debug = new WgslDebugEngine();
  const request = { workspace, sourceUri: path, position: { line: 1, character: 65 } };
  const analysis = debug.analyze(request);
  expect(analysis.ok).toBe(true);
  if (!analysis.ok) {
    return;
  }
  const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "value")!;
  const plan = debug.planCapture(request, [value.id], { normalizeMode: "off", stepEdge: null, output: 4 });
  expect(plan).toMatchObject({ ok: true, plan: { nativeRender: { fragmentEntryPoint: "image", output: 4 } } });
});

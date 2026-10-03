import { describe, expect, it } from "vitest";
import type { DebugAnalysisRequest } from "@shader-studio/types";
import { WgslDebugEngine } from "../wgsl/WgslDebugEngine";
import { SlangDebugEngine } from "../slang/SlangDebugEngine";

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
      expect(rewritten).toContain("mainImage(");
      expect(rewritten).toContain("_ssdbg_abcd1234_userMain");
      expect(rewritten).toContain("iResolution.y -");
      expect(rewritten).toContain("_slot1 = value");
      expect(rewritten).toContain("_legacyMainImage");
    }
  });

  it("reports varying-dependent fragments as unsupported pixel replay", () => {
    const input = request("@fragment fn image(@location(0) uv: vec2f) -> @location(0) vec4f {\n  let value = uv.x;\n  return vec4f(value);\n}", "wgsl", "image", 1);
    const result = new WgslDebugEngine().planPreview(input, { normalizeMode: "off", stepEdge: null });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-unsupported-syntax", message: expect.stringContaining("raster replay") }] });
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

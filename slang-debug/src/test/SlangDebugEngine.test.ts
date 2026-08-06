import { describe, expect, it } from "vitest";
import { SlangDebugEngine } from "../SlangDebugEngine";

const request = {
  workspace: {
    rootUri: "/work/main.slang", rootPath: "/work/main.slang", passName: "Image", contentHash: "abcd1234",
    files: [{ uri: "/work/main.slang", path: "/work/main.slang", version: 1, moduleName: "", ownerPass: "Image", source: "float4 mainImage(float2 fragCoord) {\n  float value = fragCoord.x;\n  return float4(value);\n}\n" }],
  },
  sourceUri: "/work/main.slang",
  position: { line: 1, character: 8 },
};

describe("SlangDebugEngine", () => {
  it("exposes analysis, preview, and selected-variable capture through the public debug contract", () => {
    const engine = new SlangDebugEngine();
    const analysis = engine.analyze(request);
    expect(analysis).toMatchObject({ ok: true, analysis: { previewValueId: "declaration:file:///work/main.slang:1:8" } });
    if (!analysis.ok) return;

    expect(engine.planPreview(request, { normalizeMode: "off", stepEdge: null })).toMatchObject({ ok: true, plan: { captureSlots: [{ index: 0, hidden: true }, { index: 1, name: "value" }] } });
    expect(engine.planCapture(request, [analysis.analysis.previewValueId!])).toMatchObject({ ok: true, plan: { captureSlots: [{ index: 0, hidden: true }, { index: 1, name: "value" }] } });
  });

  it("previews an in-scope return value wrapped in a Slang constructor", () => {
    const defaultRequest = {
      workspace: {
        rootUri: "/work/default.slang", rootPath: "/work/default.slang", passName: "Image", contentHash: "default1234",
        files: [{ uri: "/work/default.slang", path: "/work/default.slang", version: 1, moduleName: "", ownerPass: "Image", source: "float4 mainImage(float2 fragCoord) {\n  float3 col = float3(fragCoord, 0.5);\n  return float4(col, 1.0);\n}\n" }],
      },
      sourceUri: "/work/default.slang",
      position: { line: 2, character: 2 },
    };
    const engine = new SlangDebugEngine();
    const analysis = engine.analyze(defaultRequest);

    expect(analysis).toMatchObject({ ok: true, analysis: { previewValueId: "return:file:///work/default.slang:2:2" } });
    if (analysis.ok) {
      expect(analysis.analysis.visibleValues[0]).toMatchObject({ name: "fragCoord", typeName: "float2" });
      expect(analysis.analysis.visibleValues).toContainEqual(expect.objectContaining({ name: "_dbgReturn", typeName: "float4" }));
    }
    expect(engine.planPreview(defaultRequest, { normalizeMode: "off", stepEdge: null })).toMatchObject({
      ok: true,
      plan: { captureSlots: [{ index: 0, hidden: true }, { index: 1, name: "_dbgReturn", typeName: "float4" }] },
    });
  });

  it("previews the full expression returned by the minimal Slang shader form", () => {
    const uvRequest = {
      workspace: {
        rootUri: "/work/uv.slang", rootPath: "/work/uv.slang", passName: "Image", contentHash: "uv123456",
        files: [{ uri: "/work/uv.slang", path: "/work/uv.slang", version: 1, moduleName: "", ownerPass: "Image", source: "float4 mainImage(float2 fragCoord) {\n  float2 uv = fragCoord / iResolution.xy;\n  return float4(uv, 1.0);\n}\n" }],
      },
      sourceUri: "/work/uv.slang",
      position: { line: 2, character: 2 },
    };
    const engine = new SlangDebugEngine();

    expect(engine.planPreview(uvRequest, { normalizeMode: "off", stepEdge: null })).toMatchObject({
      ok: true,
      plan: { captureSlots: [{ index: 0, hidden: true }, { index: 1, name: "_dbgReturn", typeName: "float4" }] },
    });
  });

  it("previews a specifically requested visible value", () => {
    const engine = new SlangDebugEngine();
    const analysis = engine.analyze({
      ...request,
      position: { line: 2, character: 2 },
    });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0]?.message);
    const value = analysis.analysis.visibleValues.find((candidate) => candidate.name === "value");
    if (!value) throw new Error("Expected value to be visible");

    expect(engine.planPreviewValue({ ...request, position: { line: 2, character: 2 } }, value.id, {
      normalizeMode: "off",
      stepEdge: null,
    })).toMatchObject({
      ok: true,
      plan: { captureSlots: [{ index: 0, hidden: true }, { index: 1, name: "value" }] },
    });
  });
});

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
});

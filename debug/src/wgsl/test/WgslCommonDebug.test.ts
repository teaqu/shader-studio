import { describe, expect, it } from "vitest";
import type { DebugAnalysisRequest } from "@shader-studio/types";
import { WgslDebugEngine } from "../WgslDebugEngine";

const common = "const gain: f32 = 0.25;\nfn shade(p: vec2f) -> f32 {\n  let value = p.x * gain;\n  return value;\n}";
const root = "fn mainImage(coord: vec2f) -> vec4f {\n  let color = shade(coord);\n  return vec4f(color);\n}";
function request(selected = "/common.wgsl", line = 2): DebugAnalysisRequest {
  return {
    workspace: { rootUri: "/main.wgsl", rootPath: "/main.wgsl", passName: "Image", contentHash: "deadbeef", files: [
      { uri: "/main.wgsl", path: "/main.wgsl", source: root, version: 7, moduleName: "", ownerPass: "Image" },
      { uri: "/common.wgsl", path: "/common.wgsl", source: common, version: 3, moduleName: "", ownerPass: "Image" },
    ] }, sourceUri: selected, position: { line, character: 2 },
  };
}
const options = { normalizeMode: "off" as const, stepEdge: null };
describe("WGSL common debugging", () => {
  it.each(["preview", "capture", "explicit"])("maps %s edits to common and root, preserving file metadata", (mode) => {
    const engine = new WgslDebugEngine();
    const input = request();
    const analyzed = engine.analyze(input);
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) throw new Error("analysis failed");
    const value = analyzed.analysis.visibleValues.find((item) => item.name === "value")!;
    expect(value).toMatchObject({ typeName: "f32", sourceUri: "/common.wgsl", declarationRange: { start: { line: 2 } } });
    const planned = mode === "capture" ? engine.planCapture(input, [value.id])
      : mode === "explicit" ? engine.planPreviewValue(input, value.id, options) : engine.planPreview(input, options);
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.diagnostics[0]?.message);
    expect(planned.plan).toMatchObject({ rootUri: "/main.wgsl", selectedSourceUri: "/common.wgsl" });
    const commonFile = planned.plan.files.find((file) => file.path === "/common.wgsl")!;
    const rootFile = planned.plan.files.find((file) => file.path === "/main.wgsl")!;
    expect(commonFile).toMatchObject({ version: 4, ownerPass: "Image" });
    expect(commonFile.source).toContain("_ssdbg_deadbeef_slot1 = value;");
    expect(commonFile.source).not.toContain("fn mainImage");
    expect(rootFile).toMatchObject({ version: 8, ownerPass: "Image" });
    expect(rootFile.source).toContain("fn _ssdbg_deadbeef_userMain");
    expect(rootFile.source).not.toContain("fn shade");
    expect(rootFile.source).not.toContain(" ? ");
    expect(input.workspace.files[0].source).toBe(root);
  });
  it("infers root values from common functions and maps ranges back to the root", () => {
    const result = new WgslDebugEngine().analyze(request("/main.wgsl", 1));
    expect(result).toMatchObject({ ok: true, analysis: { sourceUri: "/main.wgsl", statementRange: { start: { line: 1 } }, visibleValues: expect.arrayContaining([expect.objectContaining({ name: "color", typeName: "f32" })]) } });
  });
  it('uses emitted file identities for canonical-equivalent request URIs', () => {
    const input = request('file:///common.wgsl');
    input.workspace.rootUri = 'file:///main.wgsl';
    const result = new WgslDebugEngine().planPreview(input, options);
    expect(result).toMatchObject({ ok: true, plan: { rootUri: '/main.wgsl', selectedSourceUri: '/common.wgsl' } });
  });
  it('maps stale plan diagnostics back to root lines', () => {
    const result = new WgslDebugEngine().planCapture(request('/main.wgsl', 1), ['stale']);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ sourceUri: '/main.wgsl', range: { start: { line: 1 } } }] });
  });
  it('retains the provenance of common globals in root analysis', () => {
    const result = new WgslDebugEngine().analyze(request('/main.wgsl', 1));
    expect(result).toMatchObject({ ok: true, analysis: { visibleValues: expect.arrayContaining([
      expect.objectContaining({ name: 'gain', sourceUri: '/common.wgsl', declarationRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } } }),
    ]) } });
  });

  it('keeps common parameter edits in common and coordinate setup in the root', () => {
    const result = new WgslDebugEngine().planPreview(request(), { ...options, customParameters: new Map([[0, 'coord / iResolution.xy']]) });
    if (!result.ok) throw new Error('plan failed');
    expect(result.plan.files.find(file => file.path === '/common.wgsl')?.source).toContain('let p: vec2f = _ssdbg_deadbeef_coord / iResolution.xy;');
    expect(result.plan.files.find(file => file.path === '/main.wgsl')?.source).toContain('_ssdbg_deadbeef_coord = coord;');
  });

});

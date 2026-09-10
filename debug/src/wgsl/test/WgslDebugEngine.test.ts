import { describe, expect, it } from "vitest";
import type { DebugWorkspace } from "@shader-studio/types";
import { WgslDebugEngine } from "../WgslDebugEngine";

const SOURCE = [
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  var value: f32 = coord.x;",
  "  return vec4f(value, 0.0, 0.0, 1.0);",
  "}",
].join("\n");

function workspace(): DebugWorkspace {
  return {
    rootUri: "file:///work/main.wgsl",
    rootPath: "file:///work/main.wgsl",
    passName: "Image",
    contentHash: "deadbeef",
    files: [{ uri: "file:///work/main.wgsl", path: "file:///work/main.wgsl", source: SOURCE, version: 1, moduleName: "", ownerPass: "Image" }],
  };
}

describe("WgslDebugEngine", () => {
  it("analyzes a WGSL site", () => {
    const engine = new WgslDebugEngine();
    const result = engine.analyze({ workspace: workspace(), sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } });

    expect(result).toMatchObject({
      ok: true,
      analysis: {
        visibleValues: [
          { name: "coord", typeName: "vec2f" },
          { name: "value", typeName: "f32" },
        ],
      },
    });
  });

  it("plans a preview for the inferred preview value", () => {
    const engine = new WgslDebugEngine();
    const result = engine.planPreview(
      { workspace: workspace(), sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } },
      { normalizeMode: "off", stepEdge: null },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.files[0]?.source).toContain("_ssdbg_deadbeef_slot1 = value;");
    }
  });

  it("plans a capture for explicit value ids", () => {
    const engine = new WgslDebugEngine();
    const analyzed = engine.analyze({ workspace: workspace(), sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } });
    if (!analyzed.ok) throw new Error("analysis failed");
    const valueId = analyzed.analysis.visibleValues.find((value) => value.name === "value")!.id;
    const result = engine.planCapture(
      { workspace: workspace(), sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } },
      [valueId],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.captureSlots).toHaveLength(2);
    }
  });

  it("plans an inspector preview for an explicit visible value", () => {
    const engine = new WgslDebugEngine();
    const analyzed = engine.analyze({ workspace: workspace(), sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } });
    if (!analyzed.ok) throw new Error("analysis failed");
    const valueId = analyzed.analysis.visibleValues.find((value) => value.name === "value")!.id;
    const result = engine.planPreviewValue(
      { workspace: workspace(), sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } },
      valueId,
      { normalizeMode: "off", stepEdge: null },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.files[0]?.source).toContain("_ssdbg_deadbeef_slot1 = value;");
    }
  });

  it("resolves workspace files through canonicalized uris", () => {
    const engine = new WgslDebugEngine();
    const rooted = workspace();
    rooted.files = [{ uri: "/work/main.wgsl", path: "/work/main.wgsl", source: SOURCE, version: 1, moduleName: "", ownerPass: "Image" }];
    rooted.rootUri = "/work/main.wgsl";
    const result = engine.analyze({ workspace: rooted, sourceUri: "file:///work/main.wgsl", position: { line: 1, character: 8 } });

    expect(result.ok).toBe(true);
  });

  it("fails closed for non-WGSL sources and unknown files", () => {
    const engine = new WgslDebugEngine();

    expect(engine.analyze({ workspace: workspace(), sourceUri: "file:///work/main.slang", position: { line: 0, character: 0 } }))
      .toMatchObject({ ok: false, diagnostics: [{ code: "debug-unsupported-language" }] });
    expect(engine.analyze({ workspace: workspace(), sourceUri: "file:///work/missing.wgsl", position: { line: 0, character: 0 } }))
      .toMatchObject({ ok: false, diagnostics: [{ code: "debug-invalid-workspace" }] });
  });
});

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
    if (!analyzed.ok) {
      throw new Error("analysis failed");
    }
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
    if (!analyzed.ok) {
      throw new Error("analysis failed");
    }
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


describe("WGSL generated debug context", () => {
  it("infers channel samples, swizzles, and metadata without emitting generated declarations", () => {
    const ws = workspace();
    ws.files[0]!.source = [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let uv = coord / iResolution.xy;",
      "  let src = albedoSample(uv);",
      "  var col = src.rgb;",
      "  let depth = albedoSampleLevel(uv, 0.0).a;",
      "  let size = albedoSize();",
      "  let loaded = albedo.loaded;",
      "  return vec4f(col * depth, 1.0);",
      "}",
    ].join("\n");
    Object.assign(ws, { channels: [{ name: "albedo", slot: 0, kind: "texture-2d" }] });
    const request = { workspace: ws, sourceUri: ws.rootUri, position: { line: 7, character: 2 } };
    const engine = new WgslDebugEngine();
    const result = engine.analyze(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.analysis.visibleValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "src", typeName: "vec4f" }),
      expect.objectContaining({ name: "col", typeName: "vec3f" }),
      expect.objectContaining({ name: "depth", typeName: "f32" }),
      expect.objectContaining({ name: "size", typeName: "vec2u" }),
      expect.objectContaining({ name: "loaded", typeName: "bool" }),
    ]));
    const plan = engine.planCapture(request, result.analysis.visibleValues.map(value => value.id));
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.files[0]!.source).not.toContain("fn albedoSample");
      expect(plan.plan.files[0]!.source).toContain(" = col;");
    }
  });

  it("types locals from script uniforms without listing the uniforms as values", () => {
    const ws = workspace();
    ws.files[0]!.source = "fn mainImage(coord: vec2f) -> vec4f {\n  // unused\n  let col = tint * gain;\n  return vec4f(col, 1.0);\n}";
    Object.assign(ws, { customUniforms: [
      { name: "tint", type: "vec3" }, { name: "gain", type: "float" }, { name: "unused", type: "float" },
    ] });
    const request = { workspace: ws, sourceUri: ws.rootUri, position: { line: 3, character: 2 } };
    const engine = new WgslDebugEngine();
    const result = engine.analyze(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Script uniforms are engine inputs shown in the Uniforms panel, as in Slang.
    expect(result.analysis.visibleValues.map(value => value.name)).toEqual(["coord", "col", "_dbgReturn"]);
    expect(result.analysis.visibleValues.find(value => value.name === "col")?.typeName).toBe("vec3f");
    const plan = engine.planCapture(request, result.analysis.visibleValues.map(value => value.id));
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.files[0]!.source).not.toContain("var<private> gain");
      expect(plan.plan.files[0]!.source).not.toContain(" = gain;");
      expect(plan.plan.files[0]!.source).toContain(" = col;");
    }
  });
});


describe("WGSL generated context boundaries", () => {
  it.each(["texture-cube", "texture-3d"])("types %s channel metadata and portable sampling", kind => {
    const ws = workspace();
    ws.files[0]!.source = "fn mainImage(coord: vec2f) -> vec4f {\n  let size = volume.size;\n  let value = volumeSampleLevel(vec3f(0.5), 0.0);\n  return value;\n}";
    Object.assign(ws, { channels: [{ name: "volume", slot: 4, kind }] });
    const result = new WgslDebugEngine().analyze({ workspace: ws, sourceUri: ws.rootUri, position: { line: 3, character: 2 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.visibleValues).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "size", typeName: kind === "texture-3d" ? "vec3u" : "vec2u" }),
        expect.objectContaining({ name: "value", typeName: "vec4f" }),
      ]));
    }
  });

  it("does not infer unconfigured channels or emit unsupported uniform types", () => {
    const ws = workspace();
    ws.files[0]!.source = "fn mainImage(coord: vec2f) -> vec4f {\n  let missing = absentSample(coord);\n  return vec4f(1.0);\n}";
    Object.assign(ws, { customUniforms: [{ name: "bad", type: "not-a-type" }, { name: "bad name", type: "float" }] });
    const result = new WgslDebugEngine().analyze({ workspace: ws, sourceUri: ws.rootUri, position: { line: 2, character: 2 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.visibleValues.map(value => value.name)).toEqual(["coord", "_dbgReturn"]);
    }
  });

  it("keeps a local shadow of a script uniform and types uniforms used only by Common", () => {
    const ws = workspace();
    ws.files[0]!.source = "fn mainImage(coord: vec2f) -> vec4f {\n  let gain = 2.0;\n  return vec4f(helper() * gain);\n}";
    ws.files.push({ ...ws.files[0]!, uri: "file:///work/common.wgsl", path: "file:///work/common.wgsl", source: "fn helper() -> f32 {\n  let amount = gain;\n  return amount;\n}" });
    Object.assign(ws, { customUniforms: [{ name: "gain", type: "float" }] });
    const engine = new WgslDebugEngine();
    const result = engine.analyze({ workspace: ws, sourceUri: ws.rootUri, position: { line: 2, character: 2 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const gains = result.analysis.visibleValues.filter(value => value.name === "gain");
      expect(gains).toHaveLength(1);
      expect(gains[0]!.declarationRange.start.line).toBe(1);
    }
    const common = engine.analyze({ workspace: ws, sourceUri: "file:///work/common.wgsl", position: { line: 2, character: 2 } });
    expect(common.ok).toBe(true);
    if (common.ok) {
      expect(common.analysis.visibleValues.map(value => value.name)).not.toContain("gain");
      expect(common.analysis.visibleValues).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "amount", typeName: "f32" }),
      ]));
    }
  });
});


describe("WGSL script uniform types", () => {
  it.each([["float", "f32"], ["vec2", "vec2f"], ["vec3", "vec3f"], ["vec4", "vec4f"], ["bool", "bool"]])("maps %s to %s in capture plans", (type, typeName) => {
    const ws = workspace();
    ws.files[0]!.source = "fn mainImage(coord: vec2f) -> vec4f {\n  let value = control;\n  return vec4f(1.0);\n}";
    ws.customUniforms = [{ name: "control", type }];
    const request = { workspace: ws, sourceUri: ws.rootUri, position: { line: 1, character: 2 } };
    const engine = new WgslDebugEngine();
    const result = engine.analyze(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.analysis.visibleValues.map(value => value.name)).not.toContain("control");
    expect(result.analysis.visibleValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "value", typeName }),
    ]));
    const plan = engine.planPreview(request, { normalizeMode: "off", stepEdge: null });
    expect(plan.ok).toBe(true);
  });
});


it("types explicit-level channel sampling in compute captures without fragment-only helpers", () => {
  const ws = workspace();
  ws.files[0]!.source = "@compute @workgroup_size(1) fn update() {\n  let value = albedoSampleLevel(vec2f(0.5), 0.0);\n  let fragmentOnly = albedoSample(vec2f(0.5));\n}";
  ws.channels = [{ name: "albedo", slot: 0, kind: "texture-2d" }];
  ws.compute = { entryPoint: "update" };
  const result = new WgslDebugEngine().analyze({ workspace: ws, sourceUri: ws.rootUri, position: { line: 2, character: 2 } });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.analysis.visibleValues.map(value => value.name)).toEqual(["value"]);
  }
});

it("plans a capture from a loop's closing brace", () => {
  const loop = [
    "fn mainImage(coord: vec2f) -> vec4f {",
    "  var total = 0.0;",
    "  for (var i = 0; i < 3; i++) {",
    "    let layer = f32(i) * coord.x;",
    "    total += layer;",
    "  }",
    "  return vec4f(total);",
    "}",
  ].join("\n");
  const engine = new WgslDebugEngine();
  const request = {
    workspace: { ...workspace(), files: [{ ...workspace().files[0]!, source: loop }] },
    sourceUri: "file:///work/main.wgsl",
    position: { line: 5, character: 2 },
  };
  const result = engine.analyze(request);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  const layer = result.analysis.visibleValues.find(value => value.name === "layer");
  expect(layer).toBeDefined();

  expect(engine.planCapture(request, [layer!.id])).toMatchObject({ ok: true });
});

import { describe, expect, it } from "vitest";
import type { DebugSourcePosition } from "@shader-studio/types";
import { analyzeWgslSite } from "../WgslDebugAnalyzer";

const URI = "file:///work/main.wgsl";

const SOURCE = [
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  var value: f32 = coord.x;",
  "  var tint: vec3f = vec3f(value);",
  "  if value > 0.0 {",
  "    tint = tint + value;",
  "  }",
  "  return vec4f(tint, 1.0);",
  "}",
].join("\n");

function analyze(source: string, position: DebugSourcePosition) {
  return analyzeWgslSite(source, URI, position);
}

describe("analyzeWgslSite", () => {
  it("lists inferred locals but never host globals as visible values", () => {
    const source = [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let t = iTime * 2.0;",
      "  return vec4f(t, 0.0, 0.0, 1.0);",
      "}",
    ].join("\n");
    const result = analyze(source, { line: 2, character: 4 });

    expect(result).toMatchObject({ ok: true });
    const names = result.ok ? result.analysis.visibleValues.map((value) => `${value.name}:${value.typeName}`) : [];
    expect(names).toContain("coord:vec2f");
    expect(names).toContain("t:f32");
    expect(names).toContain("_dbgReturn:vec4f");
    expect(names.some((entry) => entry.startsWith("iTime"))).toBe(false);
    expect(names.some((entry) => entry.startsWith("iResolution"))).toBe(false);
  });

  it("reports visible values with shadowing and the enclosing control flow", () => {
    const result = analyze(SOURCE, { line: 4, character: 10 });

    expect(result).toMatchObject({
      ok: true,
      analysis: {
        visibleValues: [{ name: "coord", typeName: "vec2f" }, { name: "value", typeName: "f32" }, { name: "tint", typeName: "vec3f" }],
        controlFlow: [{ kind: "if" }],
      },
    });
  });

  it("selects a direct declaration as preview and rejects unsupported types", () => {
    const declared = analyze(SOURCE, { line: 1, character: 8 });
    const value = declared.ok ? declared.analysis.visibleValues.find((item) => item.name === "value") : undefined;
    expect(declared).toMatchObject({ ok: true });
    expect(declared.ok && declared.analysis.previewValueId).toBe(value?.id);
    const matrixSource = "fn mainImage(coord: vec2f) -> vec4f {\n  var m: mat4x4f = mat4x4f();\n  return vec4f(1.0);\n}";
    expect(analyze(matrixSource, { line: 1, character: 8 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "wgsl-debug-non-capturable-type" }],
    });
  });

  it.each([
    ["annotated alias", "  var m: mat2x2f = mat2x2f(0.125, 0.25, 0.5, 0.75);", "mat2x2f"],
    ["annotated parameterized", "  let m: mat2x2<f32> = mat2x2<f32>(0.125, 0.25, 0.5, 0.75);", "mat2x2<f32>"],
    ["inferred alias", "  let m = mat2x2f(0.125, 0.25, 0.5, 0.75);", "mat2x2f"],
    ["inferred parameterized", "  var m = mat2x2<f32>(vec2f(0.125, 0.25), vec2f(0.5, 0.75));", "mat2x2<f32>"],
  ])("captures a %s 2x2 matrix local as its preview", (_label, declaration, typeName) => {
    const source = `fn mainImage(coord: vec2f) -> vec4f {\n${declaration}\n  return vec4f(m[0], m[1]);\n}`;
    const result = analyze(source, { line: 1, character: 4 });
    expect(result).toMatchObject({ ok: true });
    const m = result.ok ? result.analysis.visibleValues.find((value) => value.name === "m") : undefined;
    expect(m).toMatchObject({ typeName });
    expect(result.ok && result.analysis.previewValueId).toBe(m?.id);
  });

  it("returns a 2x2 matrix from a helper and infers its column type", () => {
    const source = [
      "fn basis(scale: f32) -> mat2x2f {",
      "  let column = mat2x2f(scale, 0.0, 0.0, scale)[1];",
      "  return mat2x2f(vec2f(scale, 0.0), column);",
      "}",
      "fn mainImage(coord: vec2f) -> vec4f { return vec4f(basis(0.5)[0], 0.0, 1.0); }",
    ].join("\n");
    const column = analyze(source, { line: 1, character: 4 });
    expect(column.ok ? column.analysis.visibleValues.find((value) => value.name === "column") : undefined)
      .toMatchObject({ typeName: "vec2f" });
    expect(analyze(source, { line: 2, character: 4 })).toMatchObject({
      ok: true,
      analysis: { visibleValues: expect.arrayContaining([expect.objectContaining({ name: "_dbgReturn", typeName: "mat2x2f" })]) },
    });
  });

  it("captures supported values inferred through targeted builtins while filtering aggregates", () => {
    const source = [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let bits = bitcast<vec2u>(coord);",
      "  let leading = countLeadingZeros(bits);",
      "  let transposed = transpose(mat2x3f());",
      "  let column = transposed[0];",
      "  let compared = coord < vec2f(0.5);",
      "  let comparisonX = compared.x;",
      "  return vec4f(vec2f(leading), column);",
      "}",
    ].join("\n");
    const result = analyze(source, { line: 7, character: 4 });

    expect(result).toMatchObject({ ok: true });
    const values = result.ok ? result.analysis.visibleValues.map((value) => `${value.name}:${value.typeName}`) : [];
    expect(values).toEqual(expect.arrayContaining([
      "bits:vec2u",
      "leading:vec2u",
      "column:vec2f",
      "comparisonX:bool",
    ]));
    expect(values.some((value) => value.startsWith("transposed:"))).toBe(false);
    expect(values.some((value) => value.startsWith("compared:"))).toBe(false);
    expect(analyze(source, { line: 3, character: 8 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "wgsl-debug-non-capturable-type" }],
    });
  });

  it("selects an assignment target as preview", () => {
    const assigned = analyze(SOURCE, { line: 4, character: 10 });
    const tint = assigned.ok ? assigned.analysis.visibleValues.find((item) => item.name === "tint") : undefined;
    expect(assigned).toMatchObject({ ok: true });
    expect(assigned.ok && assigned.analysis.previewValueId).toBe(tint?.id);
  });

  it("synthesizes a return value on return statements", () => {
    const result = analyze(SOURCE, { line: 6, character: 10 });

    expect(result).toMatchObject({
      ok: true,
      analysis: {
        previewValueId: expect.stringContaining("return:"),
        visibleValues: expect.arrayContaining([expect.objectContaining({ name: "_dbgReturn", typeName: "vec4f" })]),
      },
    });
  });

  it("reports non-executable lines using editor-style line numbers", () => {
    const result = analyze(SOURCE, { line: 8, character: 0 });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ message: expect.stringContaining('L9: "(unknown)"') }],
    });
  });

  it("reports variables at an if header", () => {
    expect(analyze(SOURCE, { line: 3, character: 5 })).toMatchObject({
      ok: true,
      analysis: {
        visibleValues: [{ name: "coord", typeName: "vec2f" }, { name: "value", typeName: "f32" }, { name: "tint", typeName: "vec3f" }],
        controlFlow: expect.arrayContaining([expect.objectContaining({ kind: "if" })]),
      },
    });
  });

  it("types locals from module-scope values without listing the module values", () => {
    const source = [
      "var<private> uFog: f32;",
      "const uHue: f32 = 0.25;",
      "override uGain: f32 = 1.0;",
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let fog = uFog * uHue * uGain;",
      "  return vec4f(fog);",
      "}",
    ].join("\n");
    const result = analyze(source, { line: 5, character: 4 });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.analysis.visibleValues.map((value) => `${value.name}:${value.typeName}`))
      .toEqual(["coord:vec2f", "fog:f32", "_dbgReturn:vec4f"]);
  });

  it("keeps block-scoped locals and a local shadowing a module value", () => {
    const source = [
      "var<private> uFog: f32;",
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let uFog = vec3f(1.0);",
      "  if coord.x > 0.0 {",
      "    let inner = uFog.x;",
      "    return vec4f(inner);",
      "  }",
      "  return vec4f(uFog, 1.0);",
      "}",
    ].join("\n");
    const result = analyze(source, { line: 5, character: 6 });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.analysis.visibleValues.map((value) => `${value.name}:${value.typeName}`))
      .toEqual(["coord:vec2f", "uFog:vec3f", "inner:f32", "_dbgReturn:vec4f"]);
  });

  describe("on the brace that closes a block", () => {
    const LOOP = [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  var total = 0.0;",
      "  for (var i = 0; i < 3; i++) {",
      "    let layer = f32(i) * coord.x;",
      "    if layer > 0.5 {",
      "      total += layer;",
      "    }",
      "    total *= 0.5;",
      "  }",
      "  return vec4f(total);",
      "}",
    ].join("\n");

    function names(position: DebugSourcePosition): string[] {
      const result = analyze(LOOP, position);
      return result.ok ? result.analysis.visibleValues.map((value) => value.name) : [];
    }

    it("reports what the loop leaves behind, from its final statement", () => {
      const result = analyze(LOOP, { line: 8, character: 2 });

      expect(names({ line: 8, character: 2 })).toEqual(expect.arrayContaining(["coord", "total", "i", "layer"]));
      expect(result).toMatchObject({
        ok: true,
        analysis: { statementRange: { start: { line: 7, character: 4 } } },
      });
    });

    it("reports an if block's own final statement on its closing brace", () => {
      expect(names({ line: 6, character: 4 })).toEqual(expect.arrayContaining(["total", "i", "layer"]));
    });

    it("keeps the control-flow site on the loop header", () => {
      const result = analyze(LOOP, { line: 2, character: 2 });

      expect(names({ line: 2, character: 2 })).not.toContain("layer");
      expect(result).toMatchObject({ ok: true, analysis: { statementRange: { start: { line: 2, character: 2 } } } });
    });

    it("keeps the control-flow site for an empty block", () => {
      const source = [
        "fn mainImage(coord: vec2f) -> vec4f {",
        "  var total = 0.0;",
        "  loop {",
        "  }",
        "  return vec4f(total);",
        "}",
      ].join("\n");
      const result = analyzeWgslSite(source, URI, { line: 3, character: 2 });

      expect(result).toMatchObject({ ok: true, analysis: { statementRange: { start: { line: 2, character: 2 } } } });
    });
  });

  it("fails closed outside any callable", () => {
    expect(analyze("var<private> x: f32 = 1.0;", { line: 0, character: 4 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "wgsl-debug-site-not-executed" }],
    });
  });
});

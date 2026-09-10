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

  it("fails closed outside any callable", () => {
    expect(analyze("var<private> x: f32 = 1.0;", { line: 0, character: 4 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "wgsl-debug-site-not-executed" }],
    });
  });
});

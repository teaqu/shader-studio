import { describe, expect, it } from "vitest";
import { parseWgslDocument } from "../parseWgslDocument.js";
import {
  buildLineStarts,
  comparePosition,
  containsDocumentRange,
  splitDeclarationInitializer,
  splitTemplateArgumentText,
  symbolAtPosition,
  visibleSymbolsAtPosition,
  wgslHostGlobalType,
} from "../WgslDocumentSupport.js";

describe("WgslDocumentSupport", () => {
  it("handles line starts, positions, and nested template arguments", () => {
    expect(buildLineStarts("")).toEqual([0]);
    expect(buildLineStarts("a\nb\n")).toEqual([0, 2, 4]);
    expect(comparePosition({ line: 1, character: 0 }, { line: 0, character: 9 })).toBeGreaterThan(0);
    expect(containsDocumentRange(
      { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
      { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
    )).toBe(true);
    expect(splitTemplateArgumentText("array<vec4<f32>, 2>")).toEqual(["vec4<f32>", "2"]);
    expect(splitTemplateArgumentText("vec4f")).toEqual([]);
    expect(splitTemplateArgumentText("array<>")).toEqual([]);
  });

  it("maps known host type spellings and rejects unsupported ones", () => {
    expect(wgslHostGlobalType(" float3 ")).toBe("vec3f");
    expect(wgslHostGlobalType("matrix")).toBeUndefined();
  });

  it("isolates only top-level declaration initializers", () => {
    const source = [
      "let comparison = left == right;",
      "let nested = mix(a, b == c);",
      "let empty = ;",
      "let multi = mix(\n  left,\n  right\n);",
    ].join("\n");
    expect(splitDeclarationInitializer(source, {
      start: { line: 0, character: 0 }, end: { line: 0, character: source.split("\n")[0]!.length },
    })).toBe("left == right");
    expect(splitDeclarationInitializer(source, {
      start: { line: 1, character: 0 }, end: { line: 1, character: source.split("\n")[1]!.length },
    })).toBe("mix(a, b == c)");
    expect(splitDeclarationInitializer(source, {
      start: { line: 2, character: 0 }, end: { line: 2, character: source.split("\n")[2]!.length },
    })).toBeUndefined();
    expect(splitDeclarationInitializer(source, {
      start: { line: 3, character: 0 }, end: { line: 6, character: 2 },
    })).toBe("mix(\n  left,\n  right\n)");
  });

  it("finds declarations and references, while rejecting invalid editor positions", () => {
    const source = "var<private> value: f32;\nfn f() { let copy = value; }";
    const document = parseWgslDocument("file:///support.wgsl", source, "fragment");

    expect(symbolAtPosition(document, { line: 0, character: 14 })?.name).toBe("value");
    expect(symbolAtPosition(document, { line: 1, character: 20 })?.name).toBe("value");
    expect(symbolAtPosition(document, { line: 1, character: 99 })).toBeNull();
    expect(visibleSymbolsAtPosition(document, { line: 99, character: 0 })).toEqual([]);
    expect(visibleSymbolsAtPosition(document, { line: 0, character: 0 }).map((symbol) => symbol.name))
      .toContain("iTime");
  });
});

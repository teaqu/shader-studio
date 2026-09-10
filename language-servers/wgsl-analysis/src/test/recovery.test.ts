import { describe, expect, it } from "vitest";
import { blankStatementAt, parseWgslDocumentAtPosition, positionOffset } from "../recovery";
import { parseWgslDocument, visibleSymbolsAtPosition } from "../parseWgslDocument";

const URI = "file:///workspace/image.wgsl";

const TYPING = [
  "fn shade(c: vec3f) -> vec3f {",
  "  var tinted: vec3f = c * 0.5;",
  "  u",
  "}",
].join("\n");

describe("blankStatementAt", () => {
  it("blanks only the statement under the cursor", () => {
    expect(blankStatementAt(TYPING, { line: 2, character: 2 })).toBe([
      "fn shade(c: vec3f) -> vec3f {",
      "  var tinted: vec3f = c * 0.5;",
      "   ",
      "}",
    ].join("\n"));
  });

  it("keeps every line and column in place", () => {
    const blanked = blankStatementAt(TYPING, { line: 2, character: 2 });

    expect(blanked.split("\n").length).toBe(TYPING.split("\n").length);
    expect(blanked.split("\n").map((line) => line.length)).toEqual(TYPING.split("\n").map((line) => line.length));
  });

  it("blanks a statement that spans several lines", () => {
    const source = "fn main() -> f32 {\n  var a: f32 = mix(\n    1.0,\n    2.0\n}";
    const blanked = blankStatementAt(source, { line: 3, character: 5 });

    expect(blanked).toBe("fn main() -> f32 {\n                   \n        \n       \n}");
    expect(blanked.split("\n").map((line) => line.length)).toEqual(source.split("\n").map((line) => line.length));
  });

  it("returns the source unchanged when the position is outside the document", () => {
    expect(blankStatementAt(TYPING, { line: 99, character: 0 })).toBe(TYPING);
    expect(blankStatementAt(TYPING, { line: 2, character: 99 })).toBe(TYPING);
    expect(blankStatementAt(TYPING, { line: 2, character: -1 })).toBe(TYPING);
  });
});

describe("positionOffset", () => {
  it("converts line/character positions to offsets", () => {
    expect(positionOffset("ab\ncde", { line: 0, character: 1 })).toBe(1);
    expect(positionOffset("ab\ncde", { line: 1, character: 2 })).toBe(5);
    expect(positionOffset("ab\ncde", { line: 2, character: 0 })).toBeUndefined();
  });
});

describe("parseWgslDocumentAtPosition", () => {
  it("keeps declarations that precede the statement being typed", () => {
    const source = [
      "var<private> exposure: f32 = 1.0;",
      "fn shade(c: vec3f) -> vec3f {",
      "  var tinted: vec3f = c * ",
      "  return tinted;",
      "}",
    ].join("\n");
    const recovered = parseWgslDocumentAtPosition(URI, source, "fragment", { line: 2, character: 24 });
    const names = recovered.symbols.map((symbol) => symbol.name);

    expect(names).toContain("exposure");
    expect(names).toContain("shade");
    const plain = parseWgslDocument(URI, source, "fragment");
    expect(plain.parsedSuccessfully).toBe(false);
  });

  it("exposes typed locals to completion after recovery", () => {
    const source = [
      "fn shade(c: vec3f) -> vec3f {",
      "  var tinted: vec3f = c;",
      "  tinted.",
      "}",
    ].join("\n");
    const recovered = parseWgslDocumentAtPosition(URI, source, "fragment", { line: 2, character: 9 });
    const visible = visibleSymbolsAtPosition(recovered, { line: 2, character: 9 })
      .find((symbol) => symbol.name === "tinted");

    expect(visible?.typeName).toBe("vec3f");
  });
});

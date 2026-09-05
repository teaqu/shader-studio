import { describe, expect, it } from "vitest";
import { blankStatementAt, parseGlslDocumentAtPosition, positionOffset } from "../recovery";
import { parseGlslDocument, visibleSymbolsAtPosition } from "../parseGlslDocument";

const uri = "file:///workspace/image.glsl";

const typing = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord * 0.5;
  u
}`;

describe("blankStatementAt", () => {
  it("blanks only the statement under the cursor", () => {
    expect(blankStatementAt(typing, { line: 2, character: 3 })).toBe(`void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord * 0.5;
   
}`);
  });

  it("keeps every line and column in place", () => {
    const blanked = blankStatementAt(typing, { line: 2, character: 3 });

    expect(blanked.split("\n").length).toBe(typing.split("\n").length);
    expect(blanked.split("\n").map((line) => line.length)).toEqual(typing.split("\n").map((line) => line.length));
  });

  it("blanks a statement that spans several lines", () => {
    const source = "void main() {\n  float a = 1.0;\n  float b = mix(\n    a,\n    a\n}";

    expect(blankStatementAt(source, { line: 4, character: 5 }))
      .toBe("void main() {\n  float a = 1.0;\n                \n      \n     \n}");
  });

  it("returns the source unchanged when the position is outside the document", () => {
    expect(blankStatementAt(typing, { line: 99, character: 0 })).toBe(typing);
    expect(blankStatementAt(typing, { line: 2, character: 99 })).toBe(typing);
    expect(blankStatementAt(typing, { line: 2, character: -1 })).toBe(typing);
  });
});

describe("positionOffset", () => {
  it("maps a position to a source offset", () => {
    expect(positionOffset(typing, { line: 0, character: 0 })).toBe(0);
    expect(positionOffset(typing, { line: 1, character: 2 })).toBe(typing.indexOf("vec2 uv"));
  });

  it("declines a position the document does not contain", () => {
    expect(positionOffset(typing, { line: 99, character: 0 })).toBeUndefined();
    expect(positionOffset(typing, { line: 1, character: 99 })).toBeUndefined();
  });
});

describe("parseGlslDocumentAtPosition", () => {
  it("recovers declarations that an unfinished statement would otherwise lose", () => {
    expect(parseGlslDocument(uri, typing, "fragment").parsedSuccessfully).toBe(false);

    const recovered = parseGlslDocumentAtPosition(uri, typing, "fragment", { line: 2, character: 3 });

    expect(recovered.parsedSuccessfully).toBe(true);
    expect(visibleSymbolsAtPosition(recovered, { line: 2, character: 3 }).map((symbol) => symbol.name))
      .toEqual(expect.arrayContaining(["uv", "coord", "color", "mainImage"]));
  });

  it("keeps the source of the recovered document usable for positions after the cursor", () => {
    const recovered = parseGlslDocumentAtPosition(uri, typing, "fragment", { line: 2, character: 3 });
    const declaration = recovered.symbols.find((symbol) => symbol.name === "uv")?.declaration;

    expect(declaration?.start.line).toBe(1);
  });

  it("reports a failed parse when blanking the statement cannot repair the document", () => {
    const unbalanced = "void mainImage(out vec4 color, in vec2 coord) {\n  float glow = 1.0;\n  g\n";

    const recovered = parseGlslDocumentAtPosition(uri, unbalanced, "fragment", { line: 2, character: 3 });

    expect(recovered.parsedSuccessfully).toBe(false);
    expect(visibleSymbolsAtPosition(recovered, { line: 2, character: 3 })).toEqual([]);
  });
});

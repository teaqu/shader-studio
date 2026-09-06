import { describe, expect, it } from "vitest";
import { declarationContext } from "../declarationContext";

const TYPES = new Set([
  "float", "vec2", "vec3", "vec4", "float3", "float4", "int", "bool", "mat4",
  "Texture2D", "StructuredBuffer", "Material",
]);
const isType = (word: string) => TYPES.has(word);

/** Classify the cursor marked by `|` in the source. */
function contextAt(source: string) {
  const offset = source.indexOf("|");
  const before = source.slice(0, offset);
  const line = before.split("\n").length - 1;
  const character = before.length - (before.lastIndexOf("\n") + 1);
  return declarationContext(source.replace("|", ""), { line, character }, isType);
}

describe("declarationContext", () => {
  it("reads a blank line inside a body as the start of a statement", () => {
    expect(contextAt("void main() {\n    |\n}")).toBe("statement-start");
  });

  it("reads the first column of a file as the start of a statement", () => {
    expect(contextAt("|")).toBe("statement-start");
  });

  it("reads a half-typed word at the start of a line as the start of a statement", () => {
    expect(contextAt("void main() {\n    fl|\n}")).toBe("statement-start");
  });

  it("reads the position after a finished statement as the start of a statement", () => {
    expect(contextAt("void main() {\n    float a = 1.0; |\n}")).toBe("statement-start");
  });

  it("reads the position after an opening brace as the start of a statement", () => {
    expect(contextAt("void main() { |")).toBe("statement-start");
  });

  it("reads the position after a qualifier as the start of a statement", () => {
    expect(contextAt("void main() {\n    const |\n}")).toBe("statement-start");
  });

  it("reads the space after a type as a declarator", () => {
    expect(contextAt("void main() {\n    float3 |\n}")).toBe("declarator");
  });

  it("reads the name being written after a type as a declarator", () => {
    expect(contextAt("void main() {\n    float3 col|\n}")).toBe("declarator");
  });

  it("reads a qualified declaration as a declarator", () => {
    expect(contextAt("void main() {\n    const vec3 up|\n}")).toBe("declarator");
  });

  it("reads a name after an array type as a declarator", () => {
    expect(contextAt("void main() {\n    float[4] weights|\n}")).toBe("declarator");
  });

  it("reads the position after a finished array declarator as an expression", () => {
    expect(contextAt("void main() {\n    float weights[4] |\n}")).toBe("expression");
  });

  it("reads a generic type as a declarator", () => {
    expect(contextAt("StructuredBuffer<float> counts|")).toBe("declarator");
  });

  it("reads a user-declared struct as a type", () => {
    expect(contextAt("void main() {\n    Material surface|\n}")).toBe("declarator");
  });

  it("reads a parameter list after a type as a declarator", () => {
    expect(contextAt("float shade(vec3 normal|")).toBe("declarator");
  });

  it("keeps the type word itself out of declarator context", () => {
    expect(contextAt("void main() {\n    float3|\n}")).toBe("statement-start");
  });

  it("reads a constructor call as an expression", () => {
    expect(contextAt("void main() {\n    col = float3(|);\n}")).toBe("expression");
  });

  it("reads the right-hand side of an assignment as an expression", () => {
    expect(contextAt("void main() {\n    float3 col = |\n}")).toBe("expression");
  });

  it("reads a half-typed word on the right-hand side as an expression", () => {
    expect(contextAt("void main() {\n    float3 col = fr|\n}")).toBe("expression");
  });

  it("reads a returned value as an expression", () => {
    expect(contextAt("float shade() {\n    return |\n}")).toBe("expression");
  });

  it("reads a call argument as an expression", () => {
    expect(contextAt("void main() {\n    col = mix(a, |);\n}")).toBe("expression");
  });

  it("reads an unknown word before a name as an expression", () => {
    expect(contextAt("void main() {\n    unknownThing name|\n}")).toBe("expression");
  });

  it("reports an expression for a position past the end of the line", () => {
    expect(declarationContext("float a = 1.0;", { line: 0, character: 99 }, isType)).toBe("expression");
  });

  it("reports an expression for a line that does not exist", () => {
    expect(declarationContext("float a = 1.0;", { line: 4, character: 0 }, isType)).toBe("expression");
  });
});

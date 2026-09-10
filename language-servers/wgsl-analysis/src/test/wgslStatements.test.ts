import { describe, expect, it } from "vitest";
import { parseWgslDocument } from "../parseWgslDocument";

const URI = "file:///workspace/image.wgsl";

const SOURCE = [
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  var color: vec3f = vec3f(1.0);",
  "  color += vec3f(0.5);",
  "  if color.x > 2.0 {",
  "    color = vec3f(0.0);",
  "  }",
  "  for (var i: i32 = 0; i < 4; i += 1) {",
  "    color[i] = 1.0;",
  "  }",
  "  return vec4f(color, 1.0);",
  "}",
].join("\n");

describe("parseWgslDocument statements", () => {
  it("accepts assignment through a dereferenced pointer", () => {
    const document = parseWgslDocument(
      URI,
      [
        "fn bump(p: ptr<function, f32>) {",
        "  *p = *p + 1.0;",
        "}",
      ].join("\n"),
      "fragment",
    );

    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([]);
  });

  it("records statement ranges with kinds and scopes", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");
    const kinds = document.statements.map((statement) => statement.kind);

    expect(kinds).toEqual([
      "declaration", "assignment", "if", "assignment", "for", "assignment", "return",
    ]);
    const declaration = document.statements[0]!;
    expect(declaration.range.start).toMatchObject({ line: 1 });
    expect(declaration.range.end).toMatchObject({ line: 1 });
    const nested = document.statements[3]!;
    expect(nested.range.start).toMatchObject({ line: 4 });
    // Nested statements belong to a block scope, not the function scope.
    const scopes = new Map(document.scopes.map((scope) => [scope.id, scope]));
    expect(scopes.get(nested.scopeId)?.kind).toBe("block");
  });

  it("records call and control-flow statement kinds", () => {
    const document = parseWgslDocument(
      URI,
      "fn f(a: f32) -> f32 {\n  f(a);\n  a;\n  discard;\n  loop { break; }\n  while a > 0.0 { a -= 1.0; }\n  switch 1 { case 1: { a = 1.0; } }\n  return a;\n}",
      "fragment",
    );

    expect(document.statements.map((statement) => statement.kind)).toEqual([
      "call", "expression", "discard", "loop", "break", "while", "assignment", "switch", "assignment", "return",
    ]);
  });

  it("parses postfix increments and decrements only in statement and for-update positions", () => {
    const document = parseWgslDocument(
      URI,
      [
        "fn count() -> f32 {",
        "  var i: i32 = 0;",
        "  for (; i < 4; i++) {",
        "    i--;",
        "  }",
        "  let after: f32 = f32(i);",
        "  return after;",
        "}",
      ].join("\n"),
      "fragment",
    );

    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([]);
    expect(document.statements.map((statement) => statement.kind)).toEqual([
      "declaration", "for", "assignment", "declaration", "return",
    ]);
    expect(document.statements.find((statement) => statement.kind === "for")?.range).toMatchObject({
      start: { line: 2 }, end: { line: 4 },
    });
    expect(document.symbols.find((symbol) => symbol.name === "after")?.typeName).toBe("f32");
  });

  it("does not accept postfix increments as arbitrary expressions", () => {
    const document = parseWgslDocument(
      URI,
      "fn invalid() {\n  var i: i32 = 0;\n  let bad = i++;\n  let after: f32 = 1.0;\n}",
      "fragment",
    );

    expect(document.parsedSuccessfully).toBe(false);
    expect(document.diagnostics).not.toEqual([]);
    expect(document.symbols.find((symbol) => symbol.name === "after")?.typeName).toBe("f32");
  });

  it("keeps statements parsed before truncation", () => {
    const document = parseWgslDocument(URI, "fn f() -> f32 {\n  var a: f32 = 1.0;\n  a += 2.0;", "fragment");

    expect(document.statements.map((statement) => statement.kind)).toEqual(["declaration", "assignment"]);
  });
});

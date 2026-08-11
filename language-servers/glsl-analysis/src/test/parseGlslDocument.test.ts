import { describe, expect, it } from "vitest";
import {
  parseGlslDocument,
  symbolAtPosition,
  visibleSymbolsAtPosition,
  type GlslSymbol,
} from "../index";

const SOURCE = [
  "struct Light { vec3 color; float power; };",
  "uniform vec3 tint;",
  "float shade(vec3 c) {",
  "  float localColor = c.x;",
  "  {",
  "    float tint = localColor;",
  "    localColor += tint;",
  "  }",
  "  return localColor;",
  "}",
  "float shade(float value) { return value; }",
  "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(shade(tint), 1.0); }",
].join("\n");

describe("parseGlslDocument", () => {
  it("indexes declarations, references, overloads, fields, and nested scopes", () => {
    const document = parseGlslDocument("file:///image.glsl", SOURCE, "fragment");

    expect(document.diagnostics).toEqual([]);
    expect(document.symbols.filter((symbol) => symbol.name === "shade")).toEqual([
      expect.objectContaining({
        kind: "function",
        typeName: "float",
        signature: "float shade(vec3)",
      }),
      expect.objectContaining({
        kind: "function",
        typeName: "float",
        signature: "float shade(float)",
      }),
    ]);
    expect(document.symbols).toContainEqual(expect.objectContaining({
      name: "color",
      kind: "field",
      typeName: "vec3",
    }));
    expect(document.symbols).toContainEqual(expect.objectContaining({
      name: "power",
      kind: "field",
      typeName: "float",
    }));
    expect(document.scopes.filter((scope) => scope.kind === "function" && scope.name === "shade")).toHaveLength(2);
    expect(document.scopes).toContainEqual(expect.objectContaining({ name: "Light", kind: "type" }));
    expect(document.scopes).toContainEqual(expect.objectContaining({ name: "{", kind: "block" }));
  });

  it("resolves declarations and references to the symbol at an original position", () => {
    const document = parseGlslDocument("file:///image.glsl", SOURCE, "fragment");

    expect(symbolAtPosition(document, { line: 1, character: 14 })?.name).toBe("tint");
    expect(symbolAtPosition(document, { line: 6, character: 20 })).toEqual(
      expect.objectContaining({ name: "tint", declaration: { start: { line: 5, character: 10 }, end: { line: 5, character: 14 } } }),
    );
    expect(symbolAtPosition(document, { line: 8, character: 10 })?.name).toBe("localColor");

    const localColor = document.symbols.find((symbol) => symbol.name === "localColor");
    expect(localColor?.references).toContainEqual({
      start: { line: 6, character: 4 },
      end: { line: 6, character: 14 },
    });
    expect(localColor?.references).toContainEqual({
      start: { line: 8, character: 9 },
      end: { line: 8, character: 19 },
    });
  });

  it("preserves overload references on the resolved function symbol", () => {
    const document = parseGlslDocument("file:///image.glsl", SOURCE, "fragment");
    const vec3Overload = document.symbols.find((symbol) => symbol.signature === "float shade(vec3)");
    const floatOverload = document.symbols.find((symbol) => symbol.signature === "float shade(float)");

    expect(vec3Overload?.references).toContainEqual({
      start: { line: 11, character: 73 },
      end: { line: 11, character: 78 },
    });
    expect(floatOverload?.references).toEqual([]);
  });

  it("resolves overload references independently of declaration order", () => {
    const source = [
      "float shade(float value) { return value; }",
      "vec3 shade(vec3 value) { return value; }",
      "uniform vec3 tint;",
      "void f(){ vec3 y=shade(tint); }",
      "",
    ].join("\n");
    const document = parseGlslDocument("file:///overload-order.glsl", source, "fragment");
    const floatOverload = document.symbols.find((symbol) => symbol.signature === "float shade(float)");
    const vec3Overload = document.symbols.find((symbol) => symbol.signature === "vec3 shade(vec3)");

    expect(floatOverload?.references).toEqual([]);
    expect(vec3Overload?.references).toEqual([
      { start: { line: 3, character: 17 }, end: { line: 3, character: 22 } },
    ]);
    expect(symbolAtPosition(document, { line: 3, character: 19 })?.id).toBe(vec3Overload?.id);
  });

  it("preserves function prototype references while resolving calls by overload", () => {
    const source = [
      "float f(float x);",
      "float f(float x) { return x; }",
      "void main() { float y=f(1.); }",
      "",
    ].join("\n");
    const document = parseGlslDocument("file:///prototype-reference.glsl", source, "fragment");
    const functionSymbol = document.symbols.find((symbol) => symbol.signature === "float f(float)");

    expect(functionSymbol?.references).toEqual([
      { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
      { start: { line: 2, character: 22 }, end: { line: 2, character: 23 } },
    ]);
    expect(symbolAtPosition(document, { line: 0, character: 6 })?.id).toBe(functionSymbol?.id);
    expect(symbolAtPosition(document, { line: 2, character: 22 })?.id).toBe(functionSymbol?.id);
  });

  it("normalizes user-defined function and parameter types from declarations", () => {
    const document = parseGlslDocument(
      "file:///types.glsl",
      "struct Light { vec3 color; };\nLight choose(Light value) { return value; }\n",
      "fragment",
    );

    expect(document.symbols).toContainEqual(expect.objectContaining({
      name: "choose",
      kind: "function",
      typeName: "Light",
      signature: "Light choose(Light)",
    }));
    expect(document.symbols).toContainEqual(expect.objectContaining({
      name: "value",
      kind: "parameter",
      typeName: "Light",
    }));
  });

  it("retains complete syntax ranges for split function and parameter declarations", () => {
    const source = [
      "float",
      "shade(",
      "  float",
      "  value",
      ") {",
      "  return value;",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///split-signature.glsl", source, "fragment");
    const shade = document.symbols.find((symbol) => symbol.kind === "function" && symbol.name === "shade");
    const value = document.symbols.find((symbol) => symbol.kind === "parameter" && symbol.name === "value");

    expect(shade?.declaration.start.line).toBe(1);
    expect(shade?.definition.start.line).toBe(0);
    expect(shade?.signature).toBe("float shade(float)");
    expect(value?.declaration.start.line).toBe(3);
    expect(value?.definition.start.line).toBe(2);
  });

  it("returns innermost declarations first and hides shadowed symbols", () => {
    const document = parseGlslDocument("file:///image.glsl", SOURCE, "fragment");
    const insideBlock = visibleSymbolsAtPosition(document, { line: 6, character: 20 });
    const afterBlock = visibleSymbolsAtPosition(document, { line: 8, character: 2 });

    expect(insideBlock.find((symbol) => symbol.name === "tint")?.declaration.start.line).toBe(5);
    expect(insideBlock.filter((symbol) => symbol.name === "tint")).toHaveLength(1);
    expect(insideBlock.map((symbol) => symbol.name)).toContain("localColor");
    expect(afterBlock.find((symbol) => symbol.name === "tint")?.declaration.start.line).toBe(1);
    expect(afterBlock.map((symbol) => symbol.name)).toContain("localColor");
  });

  it("maps preprocessed declarations and references in both directions", () => {
    const source = [
      "#define VALUE 12.0",
      "float tint = VALUE;",
      "float use = tint;",
      "",
    ].join("\n");
    const document = parseGlslDocument("file:///mapped.glsl", source, "fragment");

    expect(document.originalToProcessed).toEqual([-1, 0, 1, 2]);
    expect(document.processedToOriginal).toEqual([1, 2, 3]);
    expect(document.symbols.find((symbol) => symbol.name === "tint")?.declaration.start.line).toBe(1);
    expect(symbolAtPosition(document, { line: 2, character: 13 })?.name).toBe("tint");
  });

  it("excludes inactive preprocessor declarations without inventing line mappings", () => {
    const source = "#if 0\nfloat hidden;\n#else\nfloat shown;\n#endif\n";
    const document = parseGlslDocument("file:///conditional.glsl", source, "fragment");

    expect(document.originalToProcessed).toEqual([-1, -1, -1, 0, -1, 1]);
    expect(document.processedToOriginal).toEqual([3, 5]);
    expect(document.symbols.some((symbol) => symbol.name === "hidden")).toBe(false);
    expect(document.symbols).toContainEqual(expect.objectContaining({ name: "shown" }));
  });

  it("keeps repeated references distinct when macro expansion shifts their columns", () => {
    const source = "#define N 123456789\nfloat x;\nvoid main(){ int a=N; x=x+1.; }\n";
    const document = parseGlslDocument("file:///references.glsl", source, "fragment");
    const x = document.symbols.find((symbol) => symbol.name === "x");

    expect(x?.references).toEqual([
      { start: { line: 2, character: 22 }, end: { line: 2, character: 23 } },
      { start: { line: 2, character: 24 }, end: { line: 2, character: 25 } },
    ]);
    expect(symbolAtPosition(document, { line: 2, character: 22 })?.id).toBe(x?.id);
    expect(symbolAtPosition(document, { line: 2, character: 24 })?.id).toBe(x?.id);
  });

  it("does not map macro-introduced identifiers over explicit repeated references", () => {
    const source = "#define X (x+12345678901234567890)\nfloat x;\nvoid main(){ float y=X; x=x+x; }\n";
    const document = parseGlslDocument("file:///introduced-reference.glsl", source, "fragment");
    const x = document.symbols.find((symbol) => symbol.name === "x");

    expect(x?.references).toEqual([
      { start: { line: 2, character: 24 }, end: { line: 2, character: 25 } },
      { start: { line: 2, character: 26 }, end: { line: 2, character: 27 } },
      { start: { line: 2, character: 28 }, end: { line: 2, character: 29 } },
    ]);
    expect(symbolAtPosition(document, { line: 2, character: 26 })?.id).toBe(x?.id);
  });

  it("indexes macro-generated declarations at their invocation ranges", () => {
    const variableDocument = parseGlslDocument(
      "file:///generated-variable.glsl",
      "#define DECL float value\nDECL;\n",
      "fragment",
    );
    const value = variableDocument.symbols.find((symbol) => symbol.name === "value");

    expect(value).toEqual(expect.objectContaining({
      kind: "variable",
      typeName: "float",
      declaration: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      },
    }));

    const functionDocument = parseGlslDocument(
      "file:///generated-function.glsl",
      "#define FN float generated(float x) { return x; }\nFN\n",
      "fragment",
    );

    expect(functionDocument.symbols).toContainEqual(expect.objectContaining({
      name: "generated",
      kind: "function",
      typeName: "float",
      signature: "float generated(float)",
      declaration: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 2 },
      },
    }));
    expect(functionDocument.symbols).toContainEqual(expect.objectContaining({
      name: "x",
      kind: "parameter",
      typeName: "float",
      declaration: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 2 },
      },
      definition: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 2 },
      },
    }));

    const argumentDocument = parseGlslDocument(
      "file:///macro-argument-declaration.glsl",
      "#define DECL(T,N) T N\nDECL(float,x);\n",
      "fragment",
    );
    expect(argumentDocument.symbols).toContainEqual(expect.objectContaining({
      name: "x",
      declaration: {
        start: { line: 1, character: 11 },
        end: { line: 1, character: 12 },
      },
      definition: {
        start: { line: 1, character: 11 },
        end: { line: 1, character: 12 },
      },
    }));
  });

  it("indexes field-selection references", () => {
    const source = "struct Light { vec3 color; };\nvec3 get(Light light) { return light.color; }\n";
    const document = parseGlslDocument("file:///fields.glsl", source, "fragment");
    const color = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "color");

    expect(color?.references).toEqual([
      { start: { line: 1, character: 37 }, end: { line: 1, character: 42 } },
    ]);
    expect(symbolAtPosition(document, { line: 1, character: 39 })?.id).toBe(color?.id);
  });

  it("propagates field types through chained and indexed selectors", () => {
    const source = [
      "struct Inner { float value; };",
      "struct Outer { Inner inner; vec3 color; };",
      "uniform Outer outer;",
      "uniform Outer lights[2];",
      "void f(){ float a=outer.inner.value; vec3 b=lights[0].color; }",
      "",
    ].join("\n");
    const document = parseGlslDocument("file:///field-chains.glsl", source, "fragment");
    const inner = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "inner");
    const value = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "value");
    const color = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "color");

    expect(symbolAtPosition(document, { line: 4, character: 26 })?.id).toBe(inner?.id);
    expect(symbolAtPosition(document, { line: 4, character: 32 })?.id).toBe(value?.id);
    expect(symbolAtPosition(document, { line: 4, character: 55 })?.id).toBe(color?.id);
    expect(inner?.references).toHaveLength(1);
    expect(value?.references).toHaveLength(1);
    expect(color?.references).toHaveLength(1);
  });

  it("resolves indexed field chains rooted in calls and grouped expressions", () => {
    const source = [
      "struct Inner { float value; };",
      "struct S { Inner inner[2]; };",
      "S makeS(){ S s; return s; }",
      "uniform S original;",
      "void f(){ float a=makeS().inner[0].value; float b=(original).inner[1].value; }",
      "",
    ].join("\n");
    const document = parseGlslDocument("file:///field-roots.glsl", source, "fragment");
    const inner = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "inner");
    const value = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "value");

    expect(document.diagnostics).toEqual([]);
    expect(inner?.references).toEqual([
      { start: { line: 4, character: 26 }, end: { line: 4, character: 31 } },
      { start: { line: 4, character: 61 }, end: { line: 4, character: 66 } },
    ]);
    expect(value?.references).toEqual([
      { start: { line: 4, character: 35 }, end: { line: 4, character: 40 } },
      { start: { line: 4, character: 70 }, end: { line: 4, character: 75 } },
    ]);
    expect(symbolAtPosition(document, { line: 4, character: 28 })?.id).toBe(inner?.id);
    expect(symbolAtPosition(document, { line: 4, character: 37 })?.id).toBe(value?.id);
    expect(symbolAtPosition(document, { line: 4, character: 63 })?.id).toBe(inner?.id);
    expect(symbolAtPosition(document, { line: 4, character: 72 })?.id).toBe(value?.id);
  });

  it("resolves fields rooted in struct constructors", () => {
    const source = "struct S { float value; };\nvoid f(){ float x=S(1.).value; }\n";
    const document = parseGlslDocument("file:///constructor-field.glsl", source, "fragment");
    const value = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "value");

    expect(value?.references).toEqual([
      { start: { line: 1, character: 24 }, end: { line: 1, character: 29 } },
    ]);
    expect(symbolAtPosition(document, { line: 1, character: 26 })?.id).toBe(value?.id);
  });

  it("uses argument types to resolve overloaded call-rooted fields", () => {
    const source = [
      "struct A { float av; };",
      "struct B { float bv; };",
      "A make(float x){ A a; return a; }",
      "B make(vec2 v){ B b; return b; }",
      "void f(){ vec2 v; float y=make(v).bv; float z=make(vec2(1.)).bv; }",
      "",
    ].join("\n");
    const document = parseGlslDocument("file:///overload-field.glsl", source, "fragment");
    const bv = document.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "bv");

    expect(bv?.references).toEqual([
      { start: { line: 4, character: 34 }, end: { line: 4, character: 36 } },
      { start: { line: 4, character: 61 }, end: { line: 4, character: 63 } },
    ]);
    expect(symbolAtPosition(document, { line: 4, character: 35 })?.id).toBe(bv?.id);
    expect(symbolAtPosition(document, { line: 4, character: 62 })?.id).toBe(bv?.id);
  });

  it("uses identity line maps when preprocessing is unnecessary", () => {
    const document = parseGlslDocument("file:///plain.glsl", "float value;\n", "vertex");

    expect(document.originalToProcessed).toEqual([0, 1]);
    expect(document.processedToOriginal).toEqual([0, 1]);
  });

  it("maps processed EOF syntax errors back to the final original code line", () => {
    const document = parseGlslDocument(
      "file:///bad.glsl",
      "#define N 2\nfloat values[N]\n",
      "fragment",
    );

    expect(document.parsedSuccessfully).toBe(false);
    expect(document.diagnostics).toHaveLength(1);
    expect(document.diagnostics[0]).toEqual(expect.objectContaining({ code: "syntax", severity: 1 }));
    expect(document.diagnostics[0]?.range.start.line).toBe(1);
    expect(document.diagnostics[0]?.range.start.character).toBeLessThanOrEqual("float values[N]".length);
  });

  it("maps an explicit syntax-error token after a long macro expansion", () => {
    const document = parseGlslDocument(
      "file:///shifted-error.glsl",
      "#define LONG 12345678901234567890\nfloat x = LONG + ;\n",
      "fragment",
    );

    expect(document.diagnostics[0]?.range).toEqual({
      start: { line: 1, character: 15 },
      end: { line: 1, character: 16 },
    });
  });

  it("maps generated syntax-error tokens to the macro invocation", () => {
    const document = parseGlslDocument(
      "file:///generated-error.glsl",
      "#define BAD +\nfloat x = BAD ;\n",
      "fragment",
    );

    expect(document.diagnostics[0]?.range).toEqual({
      start: { line: 1, character: 10 },
      end: { line: 1, character: 13 },
    });
  });

  it("maps function-like macro errors to the macro name", () => {
    const document = parseGlslDocument(
      "file:///function-macro-error.glsl",
      "#define BAD(x) x +\nfloat x = BAD(1.0);\n",
      "fragment",
    );

    expect(document.diagnostics[0]?.range).toEqual({
      start: { line: 1, character: 10 },
      end: { line: 1, character: 13 },
    });
  });

  it("distinguishes an explicit trailing token from true EOF after expansion", () => {
    const explicitToken = parseGlslDocument(
      "file:///trailing-token.glsl",
      "#define LONG 12345678901234567890\nfloat x = LONG +\n",
      "fragment",
    );
    const trueEof = parseGlslDocument(
      "file:///true-eof.glsl",
      "#define LONG 12345678901234567890\nfloat x = LONG\n",
      "fragment",
    );

    expect(explicitToken.diagnostics[0]?.range).toEqual({
      start: { line: 1, character: 15 },
      end: { line: 1, character: 16 },
    });
    expect(trueEof.diagnostics[0]?.range).toEqual({
      start: { line: 1, character: 14 },
      end: { line: 1, character: 14 },
    });
  });

  it("returns precise original ranges for ordinary malformed syntax", () => {
    const document = parseGlslDocument("file:///bad.glsl", "float broken = ;\n", "fragment");

    expect(document.diagnostics).toHaveLength(1);
    expect(document.diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 15 },
      end: { line: 0, character: 16 },
    });
  });

  it("reports preprocessing failures while retaining the raw-parser fallback", () => {
    const document = parseGlslDocument("file:///fallback.glsl", "#if\nfloat kept;\n", "compute");

    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([
      expect.objectContaining({
        code: "preprocess",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      }),
    ]);
    expect(document.symbols).toContainEqual(expect.objectContaining({ name: "kept", typeName: "float" }));
  });

  it("reports both preprocessing and syntax failures when the raw fallback also fails", () => {
    const document = parseGlslDocument(
      "file:///double-failure.glsl",
      "#if\nfloat broken = ;\n",
      "fragment",
    );

    expect(document.parsedSuccessfully).toBe(false);
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["preprocess", "syntax"]);
    expect(document.diagnostics.map((diagnostic) => diagnostic.range.start.line)).toEqual([0, 1]);
    expect(document.symbols).toEqual([]);
  });

  it("returns a frozen document graph", () => {
    const document = parseGlslDocument("file:///image.glsl", SOURCE, "fragment");
    const firstSymbol = document.symbols[0];

    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.symbols)).toBe(true);
    expect(Object.isFrozen(firstSymbol)).toBe(true);
    expect(Object.isFrozen(firstSymbol?.declaration)).toBe(true);
    expect(Object.isFrozen(firstSymbol?.declaration.start)).toBe(true);
    expect(Object.isFrozen(firstSymbol?.definition)).toBe(true);
    expect(Object.isFrozen(firstSymbol?.definition.start)).toBe(true);
    expect(Object.isFrozen(firstSymbol?.references)).toBe(true);
    expect(Object.isFrozen(document.scopes[0]?.symbolIds)).toBe(true);
    expect(() => (document.symbols as GlslSymbol[]).push(firstSymbol!)).toThrow();
  });

  it("handles invalid, boundary, and EOF positions without leaking a nearby symbol", () => {
    const document = parseGlslDocument("file:///plain.glsl", "float value;\n", "fragment");

    expect(symbolAtPosition(document, { line: -1, character: 0 })).toBeNull();
    expect(symbolAtPosition(document, { line: 0, character: 6 })?.name).toBe("value");
    expect(symbolAtPosition(document, { line: 0, character: 11 })).toBeNull();
    expect(symbolAtPosition(document, { line: 1, character: 0 })).toBeNull();
    expect(symbolAtPosition(document, { line: 2, character: 0 })).toBeNull();
    expect(visibleSymbolsAtPosition(document, { line: 2, character: 0 })).toEqual([]);
  });
});

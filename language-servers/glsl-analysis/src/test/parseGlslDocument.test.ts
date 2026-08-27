import { describe, expect, it } from "vitest";
import { buildGlslAuthoringPreamble } from "../../../../types/src/shader-environment/GlslEnvironmentGenerator";
import type { ShaderAuthoringEnvironment } from "../../../../types/src/shader-environment/ShaderAuthoringEnvironment";
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

function offsetAtPosition(source: string, position: { line: number; character: number }): number {
  return source.split("\n")
    .slice(0, position.line)
    .reduce((offset, line) => offset + line.length + 1, 0) + position.character;
}

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

  it("resolves expression argument types independently of overload declaration order", () => {
    const definitions = [
      "int choose(int value) { return value; }",
      "float choose(float value) { return value; }",
      "vec2 choose(vec2 value) { return value; }",
      "vec3 choose(vec3 value) { return value; }",
      "bool choose(bool value) { return value; }",
    ];
    const calls = [
      ["  int intBinary = choose(1 + 2);", "int choose(int)"],
      ["  float floatBinary = choose(1.0 + 2.0);", "float choose(float)"],
      ["  int unary = choose(-values[0]);", "int choose(int)"],
      ["  float conditional = choose(condition ? 1.0 : 2.0);", "float choose(float)"],
      ["  vec3 swizzle3 = choose(color.xyz);", "vec3 choose(vec3)"],
      ["  vec2 swizzle2 = choose(color.xy);", "vec2 choose(vec2)"],
      ["  float vectorIndex = choose(color[0]);", "float choose(float)"],
      ["  vec3 vectorConstructor = choose(vec3(1.0));", "vec3 choose(vec3)"],
      ["  float explicitFloat = choose(float(1));", "float choose(float)"],
      ["  int explicitInt = choose(int(1.0));", "int choose(int)"],
      ["  bool explicitBool = choose(bool(1));", "bool choose(bool)"],
    ] as const;

    for (const [index, orderedDefinitions] of [definitions, [...definitions].reverse()].entries()) {
      const lines = [
        ...orderedDefinitions,
        "void exercise(bool condition, vec4 color, int values[2]) {",
        ...calls.map(([source]) => source),
        "}",
      ];
      const document = parseGlslDocument(
        `file:///expression-overloads-${index}.glsl`,
        lines.join("\n"),
        "fragment",
      );

      for (const [callIndex, [source, signature]] of calls.entries()) {
        const line = orderedDefinitions.length + 1 + callIndex;
        const symbol = symbolAtPosition(document, {
          line,
          character: source.indexOf("choose") + 2,
        });
        expect(symbol?.signature, `${index}:${source}`).toBe(signature);
      }
    }
  });

  it("leaves an unresolved overloaded call unclaimed", () => {
    const source = [
      "int choose(int value) { return value; }",
      "float choose(float value) { return value; }",
      "void exercise() { choose(missing); }",
    ].join("\n");
    const document = parseGlslDocument("file:///ambiguous-overload.glsl", source, "fragment");

    expect(symbolAtPosition(document, { line: 2, character: 20 })).toBeNull();
    expect(document.symbols.filter((symbol) => symbol.name === "choose")).toEqual([
      expect.objectContaining({ signature: "int choose(int)", references: [] }),
      expect.objectContaining({ signature: "float choose(float)", references: [] }),
    ]);
  });

  it("does not treat a scalar expression as indexable", () => {
    const source = [
      "int choose(int value) { return value; }",
      "float choose(float value) { return value; }",
      "void exercise(int scalar) { choose(scalar[0]); }",
    ].join("\n");
    const document = parseGlslDocument("file:///invalid-scalar-index.glsl", source, "fragment");

    expect(symbolAtPosition(document, { line: 2, character: 30 })).toBeNull();
    expect(document.symbols.filter((symbol) => symbol.name === "choose")).toEqual([
      expect.objectContaining({ signature: "int choose(int)", references: [] }),
      expect.objectContaining({ signature: "float choose(float)", references: [] }),
    ]);
  });

  it("retains array shape through parameters and function return values", () => {
    const source = [
      "int consume(int values[2]) { return values[0]; }",
      "float consume(float values[2]) { return values[0]; }",
      "int select(int value) { return value; }",
      "float select(float value) { return value; }",
      "int[2] makeValues() { int values[2]; return values; }",
      "void exercise() {",
      "  int values[2];",
      "  int direct = consume(values);",
      "  int returned = select(makeValues()[0]);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///array-expression-shapes.glsl", source, "fragment");

    const intArrayOverload = document.symbols.find((symbol) => symbol.signature === "int consume(int[2])");
    const intScalarOverload = document.symbols.find((symbol) => symbol.signature === "int select(int)");
    expect(symbolAtPosition(document, { line: 7, character: 18 })?.id).toBe(intArrayOverload?.id);
    expect(symbolAtPosition(document, { line: 8, character: 20 })?.id).toBe(intScalarOverload?.id);
    expect(intArrayOverload?.references).toHaveLength(1);
    expect(intScalarOverload?.references).toHaveLength(1);
  });

  it("publishes readable array shapes for every public symbol surface", () => {
    const source = [
      "int pick(int values[2]) { return values[0]; }",
      "int pick(int values[3]) { return values[0]; }",
      "int[2] makeValues() { int result[2]; return result; }",
      "struct Holder { int values[3]; int grid[2][3]; };",
      "int globalValues[2];",
      "int unsizedValues[];",
      "void consume(int grid[2][3]) {}",
    ].join("\n");
    const document = parseGlslDocument("file:///public-array-shapes.glsl", source, "fragment");
    const symbol = (kind: GlslSymbol["kind"], name: string, line?: number) => document.symbols.find((candidate) => (
      candidate.kind === kind
      && candidate.name === name
      && (line === undefined || candidate.definition.start.line === line)
    ));

    expect(symbol("variable", "globalValues")?.typeName).toBe("int[2]");
    expect(symbol("variable", "unsizedValues")?.typeName).toBe("int[]");
    expect(symbol("parameter", "values", 0)?.typeName).toBe("int[2]");
    expect(symbol("parameter", "values", 1)?.typeName).toBe("int[3]");
    expect(symbol("parameter", "grid", 6)?.typeName).toBe("int[2][3]");
    expect(symbol("field", "values")?.typeName).toBe("int[3]");
    expect(symbol("field", "grid")?.typeName).toBe("int[2][3]");
    expect(symbol("function", "makeValues")).toMatchObject({
      typeName: "int[2]",
      signature: "int[2] makeValues()",
    });
    expect(document.symbols.filter((candidate) => candidate.kind === "function" && candidate.name === "pick")
      .map((candidate) => candidate.signature)).toEqual([
      "int pick(int[2])",
      "int pick(int[3])",
    ]);
  });

  it("resolves array overloads by every known extent independently of declaration order", () => {
    const definitions = [
      "int pick(int values[2]) { return 2; }",
      "int pick(int values[3]) { return 3; }",
    ];

    for (const [index, orderedDefinitions] of [definitions, [...definitions].reverse()].entries()) {
      const source = [
        ...orderedDefinitions,
        "int two[2], three[3], four[4];",
        "void exercise() {",
        "  int selectedTwo = pick(two);",
        "  int selectedThree = pick(three);",
        "  int selectedFour = pick(four);",
        "}",
      ].join("\n");
      const document = parseGlslDocument(`file:///array-overloads-${index}.glsl`, source, "fragment");
      const extentTwo = document.symbols.find((symbol) => (
        symbol.kind === "function" && symbol.name === "pick" && symbol.definition.start.line === orderedDefinitions.indexOf(definitions[0])
      ));
      const extentThree = document.symbols.find((symbol) => (
        symbol.kind === "function" && symbol.name === "pick" && symbol.definition.start.line === orderedDefinitions.indexOf(definitions[1])
      ));
      const firstCallLine = orderedDefinitions.length + 2;

      expect(symbolAtPosition(document, { line: firstCallLine, character: 22 })?.id).toBe(extentTwo?.id);
      expect(symbolAtPosition(document, { line: firstCallLine + 1, character: 24 })?.id).toBe(extentThree?.id);
      expect(symbolAtPosition(document, { line: firstCallLine + 2, character: 23 })).toBeNull();
      expect(extentTwo?.references).toHaveLength(1);
      expect(extentThree?.references).toHaveLength(1);
    }
  });

  it("does not equate an unknown array extent with a known overload extent", () => {
    const source = [
      "int pick(int values[2]) { return 2; }",
      "int extent = 2;",
      "int unknown[extent];",
      "void exercise() {",
      "  int selected = pick(unknown);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///unknown-array-extent.glsl", source, "fragment");

    expect(document.diagnostics).toEqual([]);
    expect(symbolAtPosition(document, { line: 4, character: 18 })).toBeNull();
    expect(document.symbols.find((symbol) => symbol.name === "pick")?.references).toEqual([]);
  });

  it("does not equate independently unknown array extents in overloads or equality", () => {
    const source = [
      "const int N = 2;",
      "const int M = 3;",
      "int pick(int values[N]) { return 1; }",
      "bool choose(bool value) { return value; }",
      "int expected[N];",
      "int actual[M];",
      "void exercise() {",
      "  int selected = pick(actual);",
      "  bool equal = choose(expected == actual);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///independent-unknown-extents.glsl", source, "fragment");

    expect(document.diagnostics).toEqual([]);
    expect(symbolAtPosition(document, { line: 7, character: 18 })).toBeNull();
    expect(symbolAtPosition(document, { line: 8, character: 17 })).toBeNull();
    expect(document.symbols.find((symbol) => symbol.name === "pick")?.references).toEqual([]);
    expect(document.symbols.find((symbol) => symbol.name === "choose")?.references).toEqual([]);
  });

  it("normalizes supported array extent literals and rejects malformed or unsafe tokens", () => {
    const source = [
      "int pick(int values[10]) { return 1; }",
      "int decimal[10];",
      "int unsignedDecimal[10u];",
      "int octal[012];",
      "int hexadecimal[0xA];",
      "void exercise() {",
      "  int fromDecimal = pick(decimal);",
      "  int fromUnsigned = pick(unsignedDecimal);",
      "  int fromOctal = pick(octal);",
      "  int fromHexadecimal = pick(hexadecimal);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///array-extent-literals.glsl", source, "fragment");
    const pick = document.symbols.find((symbol) => symbol.name === "pick");

    for (const line of [6, 7, 8, 9]) {
      const character = source.split("\n")[line]!.indexOf("pick") + 2;
      expect(symbolAtPosition(document, { line, character })?.id).toBe(pick?.id);
    }
    expect(pick?.references).toHaveLength(4);

    const malformed = parseGlslDocument(
      "file:///malformed-array-extent.glsl",
      "int malformed[08];\n",
      "fragment",
    );
    expect(malformed.parsedSuccessfully).toBe(false);
    expect(malformed.diagnostics).toHaveLength(1);

    const unsafeSource = [
      "int pick(int values[10]) { return 1; }",
      "int unsafe[9007199254740993];",
      "void exercise() { int selected = pick(unsafe); }",
    ].join("\n");
    const unsafe = parseGlslDocument("file:///unsafe-array-extent.glsl", unsafeSource, "fragment");
    expect(unsafe.parsedSuccessfully).toBe(true);
    expect(symbolAtPosition(unsafe, { line: 2, character: 35 })).toBeNull();
  });

  it("retains array extents through function returns and struct fields", () => {
    const source = [
      "int pick(int values[2]) { return 2; }",
      "int pick(int values[3]) { return 3; }",
      "int[2] makeTwo() { int values[2]; return values; }",
      "struct Holder { int values[3]; };",
      "Holder holder;",
      "void exercise() {",
      "  int returned = pick(makeTwo());",
      "  int field = pick(holder.values);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///array-shape-producers.glsl", source, "fragment");
    const extentTwo = document.symbols.find((symbol) => (
      symbol.kind === "function" && symbol.name === "pick" && symbol.definition.start.line === 0
    ));
    const extentThree = document.symbols.find((symbol) => (
      symbol.kind === "function" && symbol.name === "pick" && symbol.definition.start.line === 1
    ));

    expect(symbolAtPosition(document, { line: 6, character: 17 })?.id).toBe(extentTwo?.id);
    expect(symbolAtPosition(document, { line: 7, character: 14 })?.id).toBe(extentThree?.id);
  });

  it("validates array, vector, and matrix subscript types before resolving overloads", () => {
    const definitions = [
      "int choose(int value) { return value; }",
      "float choose(float value) { return value; }",
      "vec2 choose(vec2 value) { return value; }",
    ];
    const calls = [
      ["  int signedArray = choose(values[1]);", "int choose(int)"],
      ["  int unsignedArray = choose(values[uint(1)]);", "int choose(int)"],
      ["  int floatArray = choose(values[1.0]);", undefined],
      ["  int boolArray = choose(values[true]);", undefined],
      ["  int vectorArray = choose(values[ivec2(0)]);", undefined],
      ["  float signedVector = choose(vector[1]);", "float choose(float)"],
      ["  float unsignedVector = choose(vector[uint(1)]);", "float choose(float)"],
      ["  float floatVector = choose(vector[1.0]);", undefined],
      ["  vec2 signedMatrix = choose(matrix[1]);", "vec2 choose(vec2)"],
      ["  vec2 unsignedMatrix = choose(matrix[uint(1)]);", "vec2 choose(vec2)"],
      ["  vec2 boolMatrix = choose(matrix[true]);", undefined],
    ] as const;

    for (const [index, orderedDefinitions] of [definitions, [...definitions].reverse()].entries()) {
      const lines = [
        ...orderedDefinitions,
        "void exercise(int values[2], vec3 vector, mat3x2 matrix) {",
        ...calls.map(([source]) => source),
        "}",
      ];
      const document = parseGlslDocument(
        `file:///validated-subscripts-${index}.glsl`,
        lines.join("\n"),
        "fragment",
      );

      for (const [callIndex, [source, signature]] of calls.entries()) {
        const symbol = symbolAtPosition(document, {
          line: orderedDefinitions.length + 1 + callIndex,
          character: source.indexOf("choose") + 2,
        });
        expect(symbol?.signature, `${index}:${source}`).toBe(signature);
      }
    }
  });

  it("retains multidimensional declarations without claiming WebGL-invalid semantic links", () => {
    const source = [
      "int chooseRow(int value[2]) { return 2; }",
      "int chooseRow(int value[3]) { return 3; }",
      "int chooseScalar(int value) { return value; }",
      "int grid[2][3];",
      "void exercise() {",
      "  int row = chooseRow(grid[1]);",
      "  int scalar = chooseScalar(grid[1][2]);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///multidimensional-indexing.glsl", source, "fragment");
    expect(document.symbols).toContainEqual(expect.objectContaining({
      kind: "variable",
      name: "grid",
      typeName: "int[2][3]",
    }));
    expect(document.symbols.filter((symbol) => symbol.name === "chooseRow")).toEqual([
      expect.objectContaining({ signature: "int chooseRow(int[2])", references: [] }),
      expect.objectContaining({ signature: "int chooseRow(int[3])", references: [] }),
    ]);
    expect(document.symbols.find((symbol) => symbol.name === "chooseScalar")?.references).toEqual([]);
    expect(symbolAtPosition(document, { line: 5, character: 14 })).toBeNull();
    expect(symbolAtPosition(document, { line: 6, character: 17 })).toBeNull();
  });

  it("resolves array equality only for compiler-compatible complete shapes", () => {
    const source = [
      "bool choose(bool value) { return value; }",
      "int sameLeft[2];",
      "int sameRight[2];",
      "int different[3];",
      "void exercise() {",
      "  bool same = choose(sameLeft == sameRight);",
      "  bool mismatch = choose(sameLeft == different);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///array-equality.glsl", source, "fragment");
    const choose = document.symbols.find((symbol) => symbol.signature === "bool choose(bool)");

    expect(symbolAtPosition(document, { line: 5, character: 16 })?.id).toBe(choose?.id);
    expect(symbolAtPosition(document, { line: 6, character: 20 })).toBeNull();
    expect(choose?.references).toHaveLength(1);
  });

  it("does not resolve sampler equality as a bool overload argument", () => {
    const source = [
      "bool choose(bool value) { return value; }",
      "uniform sampler2D leftSampler;",
      "uniform sampler2D rightSampler;",
      "void exercise() {",
      "  bool selected = choose(leftSampler == rightSampler);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///opaque-equality.glsl", source, "fragment");
    const choose = document.symbols.find((symbol) => symbol.signature === "bool choose(bool)");

    expect(symbolAtPosition(document, { line: 4, character: 20 })).toBeNull();
    expect(choose?.references).toEqual([]);
  });

  it("resolves equality only for provably comparable built-in values", () => {
    const source = [
      "bool choose(bool value) { return value; }",
      "struct Pair { int value; };",
      "Pair leftPair; Pair rightPair;",
      "int leftArray[2]; int rightArray[2];",
      "void exercise() {",
      "  bool scalar = choose(1 == 2);",
      "  bool vector = choose(vec2(1.0) == vec2(2.0));",
      "  bool matrix = choose(mat2(1.0) == mat2(2.0));",
      "  bool array = choose(leftArray == rightArray);",
      "  bool structure = choose(leftPair == rightPair);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///comparable-equality.glsl", source, "fragment");
    const choose = document.symbols.find((symbol) => symbol.signature === "bool choose(bool)");

    for (const line of [5, 6, 7, 8]) {
      expect(symbolAtPosition(document, { line, character: 18 })?.id).toBe(choose?.id);
    }
    expect(symbolAtPosition(document, { line: 9, character: 21 })).toBeNull();
    expect(choose?.references).toHaveLength(4);
  });

  it("resolves GLSL ES binary operator shapes without claiming invalid expressions", () => {
    const definitions = [
      "vec3 choose(vec3 value) { return value; }",
      "vec2 choose(vec2 value) { return value; }",
      "mat2 choose(mat2 value) { return value; }",
      "mat3 choose(mat3 value) { return value; }",
      "mat2x3 choose(mat2x3 value) { return value; }",
      "ivec2 choose(ivec2 value) { return value; }",
      "int choose(int value) { return value; }",
      "float choose(float value) { return value; }",
      "bool choose(bool value) { return value; }",
    ];
    const calls = [
      ["  vec3 matrixVector = choose(matrix23 * vector2);", "vec3 choose(vec3)"],
      ["  vec2 vectorMatrix = choose(vector3 * matrix23);", "vec2 choose(vec2)"],
      ["  mat3 matrixMatrix = choose(matrix23 * matrix32);", "mat3 choose(mat3)"],
      ["  mat2 scalarMatrix = choose(1.0 + matrix2);", "mat2 choose(mat2)"],
      ["  ivec2 vectorBitwise = choose(bits & 1);", "ivec2 choose(ivec2)"],
      ["  ivec2 vectorModulo = choose(bits % 2);", "ivec2 choose(ivec2)"],
      ["  int mixedShift = choose(1 << 2u);", "int choose(int)"],
      ["  ivec2 vectorShift = choose(bits << 2u);", "ivec2 choose(ivec2)"],
      ["  mat2x3 invalidMatrixProduct = choose(matrix23 * matrix23);", undefined],
      ["  float invalidModulo = choose(1.0 % 2.0);", undefined],
      ["  bool invalidRelational = choose(vector2 < vector2);", undefined],
    ] as const;

    for (const [index, orderedDefinitions] of [definitions, [...definitions].reverse()].entries()) {
      const lines = [
        ...orderedDefinitions,
        "void exercise(mat2x3 matrix23, mat3x2 matrix32, vec2 vector2, vec3 vector3, mat2 matrix2, ivec2 bits) {",
        ...calls.map(([source]) => source),
        "}",
      ];
      const document = parseGlslDocument(
        `file:///binary-operator-shapes-${index}.glsl`,
        lines.join("\n"),
        "fragment",
      );

      for (const [callIndex, [source, signature]] of calls.entries()) {
        const line = orderedDefinitions.length + 1 + callIndex;
        const symbol = symbolAtPosition(document, {
          line,
          character: source.indexOf("choose") + 2,
        });
        expect(symbol?.signature, `${index}:${source}`).toBe(signature);
      }
    }
  });

  it("matches square-matrix alias spellings during expression resolution", () => {
    const source = [
      "mat2 accept2(mat2 value) { return value; }",
      "mat3 accept3(mat3x3 value) { return value; }",
      "void exercise(mat2x3 matrix23, mat3x2 matrix32) {",
      "  mat2 constructorAlias = accept2(mat2x2(1.0));",
      "  mat3 productAlias = accept3(matrix23 * matrix32);",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///square-matrix-aliases.glsl", source, "fragment");

    expect(symbolAtPosition(document, { line: 3, character: 30 })?.signature).toBe("mat2 accept2(mat2)");
    expect(symbolAtPosition(document, { line: 4, character: 25 })?.signature).toBe("mat3 accept3(mat3x3)");
  });

  it("normalizes an explicit void parameter list for zero-argument calls", () => {
    const source = [
      "float value(void) { return 1.0; }",
      "float choose(float input) { return input; }",
      "void exercise() { float selected = choose(value()); }",
    ].join("\n");
    const document = parseGlslDocument("file:///void-parameter-list.glsl", source, "fragment");
    const value = document.symbols.find((symbol) => symbol.signature === "float value(void)");
    const choose = document.symbols.find((symbol) => symbol.signature === "float choose(float)");

    expect(symbolAtPosition(document, { line: 2, character: 44 })?.id).toBe(value?.id);
    expect(symbolAtPosition(document, { line: 2, character: 38 })?.id).toBe(choose?.id);
    expect(value?.references).toHaveLength(1);
    expect(choose?.references).toHaveLength(1);
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

  it("indexes every iCh0 field from the real generated anonymous-struct preamble", () => {
    const environment: ShaderAuthoringEnvironment = {
      documentUri: "file:///generated-image.glsl",
      languageId: "glsl",
      generation: 1,
      passName: "Image",
      stage: "fragment",
      customUniforms: [],
      resources: [],
      virtualFiles: [],
    };
    const preamble = buildGlslAuthoringPreamble(environment).text;
    const usage = [
      "void inspectChannelMetadata() {",
      "  sampler2D selectedSampler = iCh0.sampler;",
      "  vec3 selectedSize = iCh0.size;",
      "  float selectedTime = iCh0.time;",
      "  int selectedLoaded = iCh0.loaded;",
      "}",
    ].join("\n");
    const source = `${preamble}\n${usage}\n`;
    const document = parseGlslDocument(environment.documentUri, source, "fragment");
    const repeated = parseGlslDocument(environment.documentUri, source, "fragment");
    const iCh0CloseOffset = source.indexOf("} iCh0;");
    const iCh0OpenOffset = source.lastIndexOf("uniform struct {", iCh0CloseOffset);

    expect(document.diagnostics).toEqual([]);
    for (const [lineOffset, fieldName, typeName] of [
      [1, "sampler", "sampler2D"],
      [2, "size", "vec3"],
      [3, "time", "float"],
      [4, "loaded", "int"],
    ] as const) {
      const line = preamble.split("\n").length + lineOffset;
      const lineText = source.split("\n")[line]!;
      const character = lineText.indexOf(`.${fieldName}`) + 1;
      const field = symbolAtPosition(document, { line, character });
      const repeatedField = symbolAtPosition(repeated, { line, character });

      expect(field).toMatchObject({ kind: "field", name: fieldName, typeName });
      expect(repeatedField?.id).toBe(field?.id);
      expect(repeatedField?.scopeId).toBe(field?.scopeId);
      const declarationOffset = offsetAtPosition(source, field!.declaration.start);
      expect(declarationOffset).toBeGreaterThan(iCh0OpenOffset);
      expect(declarationOffset).toBeLessThan(iCh0CloseOffset);
      expect(source.slice(
        declarationOffset,
        offsetAtPosition(source, field!.declaration.end),
      )).toBe(fieldName);
      expect(symbolAtPosition(document, field!.declaration.start)?.id).toBe(field?.id);
    }

    const samplerUsageLine = preamble.split("\n").length + 1;
    const samplerUsage = source.split("\n")[samplerUsageLine]!;
    const iCh0Sampler = symbolAtPosition(document, {
      line: samplerUsageLine,
      character: samplerUsage.indexOf(".sampler") + 1,
    });
    const anonymousScopes = document.scopes.filter((scope) => scope.id === iCh0Sampler?.scopeId);

    expect(anonymousScopes).toHaveLength(1);
    expect(anonymousScopes[0]?.name).toBe("anonymous struct");
    expect(anonymousScopes[0]?.name).not.toContain("@anonymous-struct:");
    expect(repeated.scopes.find((scope) => scope.id === anonymousScopes[0]?.id)).toEqual(anonymousScopes[0]);
    expect(document.symbols.every((symbol) => (
      !symbol.typeName?.includes("@array:")
      && !symbol.typeName?.includes("@anonymous-struct:")
      && !symbol.signature?.includes("@array:")
      && !symbol.signature?.includes("@anonymous-struct:")
    ))).toBe(true);
    expect(document.scopes.every((scope) => (
      !scope.name.includes("@array:") && !scope.name.includes("@anonymous-struct:")
    ))).toBe(true);
  });

  it("propagates field types through chained and indexed selectors", () => {
    const source = [
      "struct Inner { float value; };",
      "struct Outer { Inner inner; vec3 color; };",
      "uniform Outer outer;",
      "uniform Outer lights[2];",
      "void f(){ float a=outer.inner.value; vec3 b=lights[0].color; vec3 c=lights[true].color; }",
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
    expect(symbolAtPosition(document, { line: 4, character: 82 })).toBeNull();
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

  it("retains unresolved variable, function, and type references for language-service diagnostics", () => {
    const source = [
      "MissingType declaredValue;",
      "void mainImage(out vec4 color, in vec2 position) {",
      "  color = vec4(missingValue) + vec4(missingFunction(position.x));",
      "}",
    ].join("\n");
    const document = parseGlslDocument("file:///unresolved.glsl", source, "fragment");

    expect(document.unresolvedReferences).toEqual(expect.arrayContaining([
      {
        name: "MissingType",
        kind: "type",
        ranges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 11 } }],
      },
      {
        name: "missingValue",
        kind: "variable",
        ranges: [{ start: { line: 2, character: 15 }, end: { line: 2, character: 27 } }],
      },
      {
        name: "missingFunction",
        kind: "function",
        ranges: [{ start: { line: 2, character: 36 }, end: { line: 2, character: 51 } }],
      },
    ]));
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
    const document = parseGlslDocument("file:///image.glsl", `${SOURCE}\nvoid unresolved() { missingValue; }`, "fragment");
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
    expect(Object.isFrozen(document.unresolvedReferences)).toBe(true);
    expect(Object.isFrozen(document.unresolvedReferences[0])).toBe(true);
    expect(Object.isFrozen(document.unresolvedReferences[0]?.ranges)).toBe(true);
    expect(Object.isFrozen(document.unresolvedReferences[0]?.ranges[0])).toBe(true);
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

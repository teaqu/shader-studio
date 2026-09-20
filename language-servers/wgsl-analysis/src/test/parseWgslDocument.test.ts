import { describe, expect, it } from "vitest";
import {
  parseWgslDocument,
  parseWgslExpression,
  symbolAtPosition,
  visibleSymbolsAtPosition,
  type WgslSymbol,
} from "../index";

const URI = "file:///workspace/image.wgsl";

const SOURCE = [
  "struct Light { color: vec3f, power: f32, }",
  "alias Brightness = f32;",
  "var<private> exposure: f32 = 1.0;",
  "let scale: vec2f = vec2f(2.0, 2.0);",
  "const PI: f32 = 3.14159;",
  "override samples: u32 = 4u;",
  "fn shade(c: vec3f, amount: Brightness) -> vec3f {",
  "  var localColor: vec3f = c * amount;",
  "  {",
  "    let c: f32 = 0.5;",
  "    localColor = localColor * c;",
  "  }",
  "  return localColor;",
  "}",
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  return vec4f(shade(vec3f(exposure), 1.0), 1.0);",
  "}",
].join("\n");

function symbolsByName(document: { symbols: readonly WgslSymbol[] }, name: string): WgslSymbol[] {
  return document.symbols.filter((symbol) => symbol.name === name);
}

describe("parseWgslDocument declarations", () => {
  it("parses structs with fields into a type scope", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");
    const light = symbolsByName(document, "Light");

    expect(light).toHaveLength(1);
    expect(light[0]).toMatchObject({ kind: "type" });
    expect(symbolsByName(document, "color")).toMatchObject([{ kind: "field", typeName: "vec3f" }]);
    expect(symbolsByName(document, "power")).toMatchObject([{ kind: "field", typeName: "f32" }]);
    const typeScope = document.scopes.find((scope) => scope.kind === "type" && scope.name === "Light");
    expect(typeScope?.symbolIds).toHaveLength(2);
  });

  it("parses aliases, globals, and constants with kinds and types", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");

    expect(symbolsByName(document, "Brightness")).toMatchObject([{ kind: "type", typeName: "f32" }]);
    expect(symbolsByName(document, "exposure")).toMatchObject([{ kind: "variable", typeName: "f32" }]);
    expect(symbolsByName(document, "scale")).toMatchObject([{ kind: "variable", typeName: "vec2f" }]);
    expect(symbolsByName(document, "PI")).toMatchObject([{ kind: "constant", typeName: "f32" }]);
    expect(symbolsByName(document, "samples")).toMatchObject([{ kind: "variable", typeName: "u32" }]);
  });

  it("parses functions with parameters, return types, and signatures", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");
    const shade = symbolsByName(document, "shade");

    expect(shade).toMatchObject([{ kind: "function", signature: "shade(vec3f, Brightness) -> vec3f" }]);
    expect(symbolsByName(document, "c")).toMatchObject([
      { kind: "parameter", typeName: "vec3f" },
      { kind: "variable", typeName: "f32" },
    ]);
    expect(symbolsByName(document, "amount")).toMatchObject([{ kind: "parameter", typeName: "Brightness" }]);
  });

  it("records declaration ranges on the right lines", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");
    const exposure = symbolsByName(document, "exposure")[0];

    expect(exposure?.declaration.start).toMatchObject({ line: 2, character: 13 });
    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([]);
  });

  it("parses every global declaration form", () => {
    const source = [
      "enable f16;",
      "requires readonly_and_readwrite_storage_textures;",
      "diagnostic(off, derivative_uniformity);",
      "const_assert 1 < 2;",
      "struct Empty { @size(16) data: u32, }",
      "@group(0) @binding(0) var<uniform> uniforms: vec4f;",
      "@group(0) @binding(1) var myTexture: texture_2d<f32>;",
      "@group(0) @binding(2) var mySampler: sampler;",
      "var<storage, read_write> buffer: array<f32, 4>;",
      "var<private> counter: atomic<u32>;",
      "var<function> ignored: ptr<function, f32>;",
      "fn empty() {}",
      "@vertex fn vertexMain(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f { return vec4f(); }",
      "@fragment fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f { return vec4f(); }",
      "@compute @workgroup_size(8, 8, 1) fn mainCompute(@builtin(global_invocation_id) id: vec3u) {}",
    ].join("\n");
    const document = parseWgslDocument(URI, source, "fragment");

    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([]);
    for (const name of ["Empty", "uniforms", "myTexture", "mySampler", "buffer", "counter", "empty", "vertexMain", "fragmentMain", "mainCompute", "vid", "uv", "id"]) {
      expect(symbolsByName(document, name)).not.toHaveLength(0);
    }
    expect(symbolsByName(document, "buffer")).toMatchObject([{ kind: "variable", typeName: "array<f32, 4>" }]);
    expect(symbolsByName(document, "myTexture")).toMatchObject([{ kind: "variable", typeName: "texture_2d<f32>" }]);
  });
});

describe("parseWgslDocument declaration keywords", () => {
  it("records the keyword each value and type was declared with", () => {
    const document = parseWgslDocument(URI, [
      "var<private> glow: f32 = 0.0;",
      "@group(0) @binding(0) var<storage, read> values: array<f32>;",
      "@group(0) @binding(1) var tex: texture_2d<f32>;",
      "@id(0) override gain: f32 = 1.0;",
      "const N = 4;",
      "struct Material { rough: f32, };",
      "alias Row = array<f32, 4>;",
      "fn f(x: f32) -> f32 {",
      "  let a = x;",
      "  var b: f32 = a;",
      "  const c = 2.0;",
      "  for (var i = 0; i < 1; i++) { }",
      "  return a + b + c;",
      "}",
    ].join("\n"), "fragment");
    const keywords = Object.fromEntries(document.symbols
      .filter((symbol) => !document.hostGlobalIds.has(symbol.id))
      .map((symbol) => [symbol.name, symbol.declarationKeyword]));

    expect(keywords).toEqual({
      glow: "var<private>",
      values: "var<storage, read>",
      tex: "var",
      gain: "override",
      N: "const",
      Material: "struct",
      rough: undefined,
      Row: "alias",
      f: "fn",
      x: undefined,
      a: "let",
      b: "var",
      c: "const",
      i: "var",
    });
  });

  it("leaves host globals without a source keyword", () => {
    const document = parseWgslDocument(URI, "fn f() {}", "fragment");
    const hostGlobals = document.symbols.filter((symbol) => document.hostGlobalIds.has(symbol.id));

    expect(hostGlobals.length).toBeGreaterThan(0);
    expect(hostGlobals.every((symbol) => symbol.declarationKeyword === undefined)).toBe(true);
  });
});

describe("parseWgslDocument statements", () => {
  it("parses every statement form", () => {
    const source = [
      "fn statements(a: f32, b: vec3f) -> f32 {",
      "  var sum: f32 = a + 1.0;",
      "  let doubled = sum * 2.0;",
      "  const limit = 10.0;",
      "  sum += doubled;",
      "  sum -= 1.0; sum *= 2.0; sum /= 2.0; sum %= 3.0;",
      "  _ = sum;",
      "  if sum > limit { sum = limit; } else if sum < 0.0 { sum = 0.0; } else { sum = 1.0; }",
      "  switch 1 { case 0, 1: { sum = 0.0; } default: { sum = 1.0; } }",
      "  loop { if sum > 100.0 { break; } continuing { sum += 1.0; break if sum > 50.0; } }",
      "  for (var i: i32 = 0; i < 4; i += 1) { sum += f32(i); }",
      "  while sum < 0.0 { sum += 1.0; continue; }",
      "  discard;",
      "  const_assert 1 < 2;",
      "  sum;",
      "  return sum;",
      "}",
    ].join("\n");
    const document = parseWgslDocument(URI, source, "fragment");

    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([]);
    expect(symbolsByName(document, "sum")).toMatchObject([{ kind: "variable", typeName: "f32" }]);
    expect(symbolsByName(document, "i")).toMatchObject([{ kind: "variable", typeName: "i32" }]);
  });
});

describe("parseWgslDocument references", () => {
  it("links references to declarations and reports unknown names", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");
    const exposure = symbolsByName(document, "exposure")[0];
    const localColor = symbolsByName(document, "localColor")[0];

    expect(exposure?.references).toHaveLength(1);
    expect(exposure?.references[0]?.start).toMatchObject({ line: 15 });
    expect(localColor?.references).toHaveLength(3);
    expect(document.unresolvedReferences).toEqual([]);
  });

  it("collects unresolved variable, function, and type references", () => {
    const document = parseWgslDocument(URI, "fn f(x: Missing) -> f32 { return mysterious + unknownFn(1.0); }", "fragment");
    const kinds = new Map(document.unresolvedReferences.map((reference) => [reference.name, reference.kind]));

    expect(kinds.get("Missing")).toBe("type");
    expect(kinds.get("mysterious")).toBe("variable");
    expect(kinds.get("unknownFn")).toBe("function");
  });

  it("finds symbols at declaration and reference positions", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");

    expect(symbolAtPosition(document, { line: 2, character: 14 })?.name).toBe("exposure");
    expect(symbolAtPosition(document, { line: 15, character: 28 })?.name).toBe("exposure");
    expect(symbolAtPosition(document, { line: 0, character: 0 })).toBeNull();
  });

  it("limits visibility by scope with shadowing", () => {
    const document = parseWgslDocument(URI, SOURCE, "fragment");
    const inner = visibleSymbolsAtPosition(document, { line: 10, character: 20 }).map((symbol) => `${symbol.kind}:${symbol.name}`);

    expect(inner).toContain("variable:c");
    expect(inner).not.toContain("parameter:c");
    expect(inner).toContain("variable:localColor");
    const outside = visibleSymbolsAtPosition(document, { line: 16, character: 0 }).map((symbol) => symbol.name);
    expect(outside).not.toContain("localColor");
    expect(outside).toContain("exposure");
  });
});

describe("parseWgslExpression", () => {
  it("respects precedence across every level", () => {
    expect(parseWgslExpression("a || b && c")).toMatchObject({
      kind: "binary", operator: "||",
      right: { kind: "binary", operator: "&&" },
    });
    expect(parseWgslExpression("a == b != c")).toMatchObject({ kind: "binary", operator: "!=" });
    expect(parseWgslExpression("a < b + c")).toMatchObject({
      kind: "binary", operator: "<",
      right: { kind: "binary", operator: "+" },
    });
    expect(parseWgslExpression("a + b * c")).toMatchObject({
      kind: "binary", operator: "+",
      right: { kind: "binary", operator: "*" },
    });
    expect(parseWgslExpression("a * b % c")).toMatchObject({ kind: "binary", operator: "%" });
    expect(parseWgslExpression("-a.b + !c")).toMatchObject({
      kind: "binary", operator: "+",
      left: { kind: "unary" },
    });
    expect(parseWgslExpression("a << b + c")).toMatchObject({
      kind: "binary", operator: "<<",
      right: { kind: "binary", operator: "+" },
    });
    expect(parseWgslExpression("a | b ^ c & d == e")).toMatchObject({
      kind: "binary", operator: "|",
      right: {
        kind: "binary", operator: "^",
        right: {
          kind: "binary", operator: "&",
          right: { kind: "binary", operator: "==" },
        },
      },
    });
    expect(parseWgslExpression("a && b | c")).toMatchObject({
      kind: "binary", operator: "&&",
      right: { kind: "binary", operator: "|" },
    });
  });

  it("parses calls, member access, and indexing", () => {
    expect(parseWgslExpression("f(a, 1.0)")).toMatchObject({
      kind: "call", name: "f",
      args: [{ kind: "identifier" }, { kind: "literal" }],
    });
    expect(parseWgslExpression("vec3f(1.0).xy")).toMatchObject({
      kind: "member", member: "xy",
      object: { kind: "call" },
    });
    expect(parseWgslExpression("arr[i + 1]")).toMatchObject({
      kind: "index",
      object: { kind: "identifier" },
      index: { kind: "binary", operator: "+" },
    });
    expect(parseWgslExpression("(a + b) * c")).toMatchObject({
      kind: "binary", operator: "*",
      left: { kind: "binary", operator: "+" },
    });
  });

  it("parses type constructors and bitcasts", () => {
    expect(parseWgslExpression("vec4<f32>(1.0)")).toMatchObject({
      kind: "call", name: "vec4<f32>", callee: "vec4", templateArguments: ["f32"],
    });
    expect(parseWgslExpression("array<vec4f, 2>(a, b)")).toMatchObject({
      kind: "call", name: "array<vec4f, 2>", callee: "array", templateArguments: ["vec4f", "2"],
    });
    expect(parseWgslExpression("bitcast<array<vec2u, 2>>(value)")).toMatchObject({
      kind: "call", callee: "bitcast", templateArguments: ["array<vec2u, 2>"],
    });
  });
});

describe("parseWgslDocument recovery", () => {
  it("keeps earlier symbols on truncated input with a diagnostic", () => {
    const document = parseWgslDocument(URI, "var<private> exposure: f32 = 1.0;\nfn shade(c: vec3f) -> vec3f {\n  var x: f32 = c.x;", "fragment");

    expect(document.parsedSuccessfully).toBe(false);
    expect(document.diagnostics.length).toBeGreaterThan(0);
    expect(symbolsByName(document, "exposure")).toHaveLength(1);
    expect(symbolsByName(document, "shade")).toHaveLength(1);
    expect(symbolsByName(document, "x")).toHaveLength(1);
  });

  it("skips a broken statement and keeps parsing", () => {
    const document = parseWgslDocument(URI, "var<private> a: f32 = 1.0;\nvar broken(;\nvar<private> b: f32 = 2.0;", "fragment");

    expect(document.parsedSuccessfully).toBe(false);
    expect(symbolsByName(document, "a")).toHaveLength(1);
    expect(symbolsByName(document, "b")).toHaveLength(1);
  });
});

describe("parseWgslDocument accepts valid WGSL without speculative syntax errors", () => {
  it.each([
    ["directives", "enable f16;\nrequires readonly_and_readwrite_storage_textures;\ndiagnostic(off, derivative_uniformity);\nfn f() {}"],
    ["overrides, const_assert and aliases", "@id(0) override gain: f32 = 1.0;\nconst N = 4;\nconst_assert N > 2;\nalias Row = array<f32, N>;\nfn f() { const_assert 1 < 2; let row: Row = Row(); }"],
    ["attributes on functions and returns", "@diagnostic(off, derivative_uniformity) @must_use fn f() -> f32 { return 1.0; }\n@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return p; }"],
    ["switch selectors with default and optional colons", "fn f(x: i32) -> i32 {\n  switch x {\n    case 1, 2 { return 1; }\n    case 3, default: { return 3; }\n  }\n  switch (x) { default { return 0; } }\n}"],
    ["switch with trailing selector comma", "fn f(x: u32) { switch x { case 1u, 2u, { } default: { } } }"],
    ["loops with continuing and break if", "fn f() { var i = 0; loop { i++; continuing { break if i > 3; } } for (;;) { break; } while (i > 0) { i--; continue; } }"],
    ["pointers and compound assignment", "fn f() { var v = vec3f(); let p = &v; (*p).x = 1.0; *p = vec3f(2.0); (*p).y += 1.0; _ = p; }"],
    ["numeric literal forms", "fn f() { let a = 0x1p-3f; let b = 1e3; let c = .5; let d = 2u; let e = 0x10i; let g = 1.5h; let h = 7f; }"],
    ["inferred and templated constructors", "fn f() { let a = array(1.0, 2.0); let b = vec3(1.0); let c = mat2x2(1.0, 0.0, 0.0, 1.0); let d = array<vec2<f32>, 2>(vec2f(), vec2f()); let e = bitcast<u32>(1i); }"],
    ["texture and sampler types", "@group(0) @binding(0) var out: texture_storage_2d<rgba8unorm, write>;\n@group(0) @binding(1) var ext: texture_external;\n@group(0) @binding(2) var depth: texture_depth_2d;\n@group(0) @binding(3) var cmp: sampler_comparison;"],
    ["relational operators beside template-like text", "fn f(a: i32, b: i32, c: i32, d: i32) -> bool { return a < b && c > d; }"],
    ["shifts and nested templates", "fn f(x: u32) -> u32 { let t: array<array<u32, 2>, 2> = array<array<u32, 2>, 2>(); return (x << 3u) >> 1u + t[0][1]; }"],
    ["workgroup and atomic storage", "var<workgroup> shared: array<f32, 4>;\n@group(0) @binding(0) var<storage, read_write> counter: atomic<u32>;\n@compute @workgroup_size(1) fn c() { atomicStore(&counter, 1u); workgroupBarrier(); shared[0] = 1.0; }"],
    ["structs with attributes and trailing commas", "struct S { @align(16) @size(32) a: vec3f, b: array<f32, 2>, };\nfn f() -> S { return S(vec3f(), array<f32, 2>()); }"],
    ["nested block comments", "/* outer /* inner */ still comment */\nfn f() { /* ( */ return; }"],
  ])("%s", (_label, source) => {
    const document = parseWgslDocument(URI, source, "fragment");
    expect(document.diagnostics).toEqual([]);
  });
});

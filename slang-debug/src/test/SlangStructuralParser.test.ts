import { describe, expect, it } from "vitest";
import { buildSlangPreprocessorModel } from "../SlangPreprocessor";
import { parseSlangStructure } from "../SlangStructuralParser";
import { tokenizeSlang } from "../SlangTokenizer";

const fullSyntaxSource = "#define DECL_FLOAT(name) float name\n"
  + "module Demo.Core;\n"
  + "import Math.Vector;\n"
  + "\n"
  + "interface IShade {\n"
  + "  float shade(float3 value);\n"
  + "}\n"
  + "\n"
  + "struct Box<T : IShade> : IShade {\n"
  + "  float field;\n"
  + "\n"
  + "  [Differentiable]\n"
  + "  float shade(in float3 value) {\n"
  + "    float shade = 1.0;\n"
  + "    if (shade > 0.0) {\n"
  + "      return shade;\n"
  + "    }\n"
  + "    for (int i = 0; i < 2; i++) {\n"
  + "      float inner = shade;\n"
  + "    }\n"
  + "    DECL_FLOAT(total);\n"
  + "    return value.x;\n"
  + "  }\n"
  + "}\n"
  + "\n"
  + "extension Box<T> {\n"
  + "  float adjust(out float value) {\n"
  + "    value = 1.0;\n"
  + "    return value;\n"
  + "  }\n"
  + "}\n"
  + "\n"
  + "[shader(\"fragment\")]\n"
  + "float4 main<T : IShade>(\n"
  + "  inout float2 uv,\n"
  + "  nointerpolation float weight\n"
  + ") {\n"
  + "  float weight = 0.0;\n"
  + "  {\n"
  + "    float weight = 1.0;\n"
  + "  }\n"
  + "  return float4(weight);\n"
  + "}\n"
  + "\n"
  + "[shader(\"fragment\")]\n"
  + "float4 main(float2 uv) {\n"
  + "  return float4(uv, 0.0, 1.0);\n"
  + "}\n";

const uri = "file:///workspace/full.slang";

function parse(sourceUri: string, source: string) {
  const document = tokenizeSlang(sourceUri, source);
  return parseSlangStructure(document, buildSlangPreprocessorModel(document));
}

describe("parseSlangStructure", () => {
  // Mutations caught: dropping a supported declaration family, merging overloads, losing generic text,
  // flattening lexical scopes, or replacing a direct macro invocation with generated source structure.
  it("builds the bounded structural model from one full-syntax source", () => {
    const structure = parse(uri, fullSyntaxSource);

    expect(structure.moduleName).toBe("Demo.Core");
    expect(structure.imports).toEqual(["Math.Vector"]);
    expect([...structure.types.values()].map((type) => ({
      id: type.id,
      kind: type.kind,
      name: type.name,
      genericParameters: type.genericParameters,
      conformances: type.conformances,
      range: type.range,
      bodyRange: type.bodyRange,
      scopeId: type.scopeId,
    }))).toEqual([
      {
        id: "type:file:///workspace/full.slang:4:10",
        kind: "interface",
        name: "IShade",
        genericParameters: [],
        conformances: [],
        range: { start: { line: 4, character: 0 }, end: { line: 6, character: 1 } },
        bodyRange: { start: { line: 4, character: 17 }, end: { line: 6, character: 1 } },
        scopeId: "scope:file:///workspace/full.slang:4:17",
      },
      {
        id: "type:file:///workspace/full.slang:8:7",
        kind: "struct",
        name: "Box",
        genericParameters: ["T : IShade"],
        conformances: ["IShade"],
        range: { start: { line: 8, character: 0 }, end: { line: 23, character: 1 } },
        bodyRange: { start: { line: 8, character: 32 }, end: { line: 23, character: 1 } },
        scopeId: "scope:file:///workspace/full.slang:8:32",
      },
      {
        id: "type:file:///workspace/full.slang:25:10",
        kind: "extension",
        name: "Box",
        genericParameters: ["T"],
        conformances: [],
        range: { start: { line: 25, character: 0 }, end: { line: 30, character: 1 } },
        bodyRange: { start: { line: 25, character: 17 }, end: { line: 30, character: 1 } },
        scopeId: "scope:file:///workspace/full.slang:25:17",
      },
    ]);

    expect([...structure.callables.values()].map((callable) => ({
      id: callable.id,
      kind: callable.kind,
      name: callable.name,
      ownerType: callable.ownerType,
      returnTypeName: callable.returnTypeName,
      genericParameters: callable.genericParameters,
      signatureRange: callable.signatureRange,
      bodyRange: callable.bodyRange,
      scopeId: callable.scopeId,
    }))).toEqual([
      {
        id: "callable:file:///workspace/full.slang:5:8",
        kind: "method",
        name: "shade",
        ownerType: "IShade",
        returnTypeName: "float",
        genericParameters: [],
        signatureRange: { start: { line: 5, character: 2 }, end: { line: 5, character: 28 } },
        bodyRange: { start: { line: 5, character: 27 }, end: { line: 5, character: 28 } },
        scopeId: "scope:file:///workspace/full.slang:4:17",
      },
      {
        id: "callable:file:///workspace/full.slang:12:8",
        kind: "method",
        name: "shade",
        ownerType: "Box",
        returnTypeName: "float",
        genericParameters: [],
        signatureRange: { start: { line: 11, character: 2 }, end: { line: 12, character: 31 } },
        bodyRange: { start: { line: 12, character: 31 }, end: { line: 22, character: 3 } },
        scopeId: "scope:file:///workspace/full.slang:12:31",
      },
      {
        id: "callable:file:///workspace/full.slang:26:8",
        kind: "extension",
        name: "adjust",
        ownerType: "Box<T>",
        returnTypeName: "float",
        genericParameters: [],
        signatureRange: { start: { line: 26, character: 2 }, end: { line: 26, character: 32 } },
        bodyRange: { start: { line: 26, character: 32 }, end: { line: 29, character: 3 } },
        scopeId: "scope:file:///workspace/full.slang:26:32",
      },
      {
        id: "callable:file:///workspace/full.slang:33:7",
        kind: "free",
        name: "main",
        ownerType: null,
        returnTypeName: "float4",
        genericParameters: ["T : IShade"],
        signatureRange: { start: { line: 32, character: 0 }, end: { line: 36, character: 2 } },
        bodyRange: { start: { line: 36, character: 2 }, end: { line: 42, character: 1 } },
        scopeId: "scope:file:///workspace/full.slang:36:2",
      },
      {
        id: "callable:file:///workspace/full.slang:45:7",
        kind: "free",
        name: "main",
        ownerType: null,
        returnTypeName: "float4",
        genericParameters: [],
        signatureRange: { start: { line: 44, character: 0 }, end: { line: 45, character: 23 } },
        bodyRange: { start: { line: 45, character: 23 }, end: { line: 47, character: 1 } },
        scopeId: "scope:file:///workspace/full.slang:45:23",
      },
    ]);

    expect([...structure.declarations.values()].map((declaration) => ({
      id: declaration.id,
      name: declaration.name,
      typeName: declaration.typeName,
      range: declaration.range,
      statementRange: declaration.statementRange,
      scopeId: declaration.scopeId,
      access: declaration.access,
      origin: declaration.origin,
    }))).toEqual(expect.arrayContaining([
      {
        id: "declaration:file:///workspace/full.slang:12:24",
        name: "value",
        typeName: "float3",
        range: { start: { line: 12, character: 24 }, end: { line: 12, character: 29 } },
        statementRange: { start: { line: 12, character: 14 }, end: { line: 12, character: 29 } },
        scopeId: "scope:file:///workspace/full.slang:12:31",
        access: "read",
        origin: {
          kind: "direct",
          writableRange: { start: { line: 12, character: 24 }, end: { line: 12, character: 29 } },
        },
      },
      {
        id: "declaration:file:///workspace/full.slang:13:10",
        name: "shade",
        typeName: "float",
        range: { start: { line: 13, character: 10 }, end: { line: 13, character: 15 } },
        statementRange: { start: { line: 13, character: 4 }, end: { line: 13, character: 22 } },
        scopeId: "scope:file:///workspace/full.slang:12:31",
        access: "readwrite",
        origin: {
          kind: "direct",
          writableRange: { start: { line: 13, character: 10 }, end: { line: 13, character: 15 } },
        },
      },
      {
        id: "declaration:file:///workspace/full.slang:20:15",
        name: "total",
        typeName: "float",
        range: { start: { line: 20, character: 15 }, end: { line: 20, character: 20 } },
        statementRange: { start: { line: 20, character: 4 }, end: { line: 20, character: 22 } },
        scopeId: "scope:file:///workspace/full.slang:12:31",
        access: "readwrite",
        origin: {
          kind: "macro-invocation",
          writableRange: { start: { line: 20, character: 4 }, end: { line: 20, character: 21 } },
        },
      },
      {
        id: "declaration:file:///workspace/full.slang:35:24",
        name: "weight",
        typeName: "float",
        range: { start: { line: 35, character: 24 }, end: { line: 35, character: 30 } },
        statementRange: { start: { line: 35, character: 2 }, end: { line: 35, character: 30 } },
        scopeId: "scope:file:///workspace/full.slang:36:2",
        access: "read",
        origin: {
          kind: "direct",
          writableRange: { start: { line: 35, character: 24 }, end: { line: 35, character: 30 } },
        },
      },
      {
        id: "declaration:file:///workspace/full.slang:37:8",
        name: "weight",
        typeName: "float",
        range: { start: { line: 37, character: 8 }, end: { line: 37, character: 14 } },
        statementRange: { start: { line: 37, character: 2 }, end: { line: 37, character: 21 } },
        scopeId: "scope:file:///workspace/full.slang:36:2",
        access: "readwrite",
        origin: {
          kind: "direct",
          writableRange: { start: { line: 37, character: 8 }, end: { line: 37, character: 14 } },
        },
      },
      {
        id: "declaration:file:///workspace/full.slang:39:10",
        name: "weight",
        typeName: "float",
        range: { start: { line: 39, character: 10 }, end: { line: 39, character: 16 } },
        statementRange: { start: { line: 39, character: 4 }, end: { line: 39, character: 23 } },
        scopeId: "scope:file:///workspace/full.slang:38:2",
        access: "readwrite",
        origin: {
          kind: "direct",
          writableRange: { start: { line: 39, character: 10 }, end: { line: 39, character: 16 } },
        },
      },
    ]));

    expect([...structure.scopes.values()].map((scope) => ({
      id: scope.id,
      kind: scope.kind,
      parentId: scope.parentId,
    }))).toEqual(expect.arrayContaining([
      { id: "scope:file:///workspace/full.slang:0:0", kind: "module", parentId: null },
      {
        id: "scope:file:///workspace/full.slang:8:32",
        kind: "type",
        parentId: "scope:file:///workspace/full.slang:0:0",
      },
      {
        id: "scope:file:///workspace/full.slang:12:31",
        kind: "callable",
        parentId: "scope:file:///workspace/full.slang:8:32",
      },
      {
        id: "scope:file:///workspace/full.slang:14:21",
        kind: "block",
        parentId: "scope:file:///workspace/full.slang:12:31",
      },
      {
        id: "scope:file:///workspace/full.slang:17:32",
        kind: "block",
        parentId: "scope:file:///workspace/full.slang:17:4",
      },
      {
        id: "scope:file:///workspace/full.slang:17:4",
        kind: "loop",
        parentId: "scope:file:///workspace/full.slang:12:31",
      },
      {
        id: "scope:file:///workspace/full.slang:38:2",
        kind: "block",
        parentId: "scope:file:///workspace/full.slang:36:2",
      },
    ]));

    expect([...structure.controlFlows.values()].map((control) => ({
      kind: control.kind,
      range: control.range,
      scopeId: control.scopeId,
    }))).toEqual(expect.arrayContaining([
      {
        kind: "if",
        range: { start: { line: 14, character: 4 }, end: { line: 16, character: 5 } },
        scopeId: "scope:file:///workspace/full.slang:12:31",
      },
      {
        kind: "for",
        range: { start: { line: 17, character: 4 }, end: { line: 19, character: 5 } },
        scopeId: "scope:file:///workspace/full.slang:12:31",
      },
    ]));
    expect([...structure.statements.values()].filter((statement) => statement.kind === "return").map((statement) => statement.range))
      .toEqual(expect.arrayContaining([
        { start: { line: 15, character: 6 }, end: { line: 15, character: 19 } },
        { start: { line: 21, character: 4 }, end: { line: 21, character: 19 } },
        { start: { line: 28, character: 4 }, end: { line: 28, character: 17 } },
        { start: { line: 41, character: 2 }, end: { line: 41, character: 24 } },
        { start: { line: 46, character: 2 }, end: { line: 46, character: 30 } },
      ]));
    expect({
      types: structure.types.size,
      callables: structure.callables.size,
      declarations: structure.declarations.size,
      scopes: structure.scopes.size,
      statements: structure.statements.size,
      controlFlows: structure.controlFlows.size,
      delimiters: structure.delimiters.size,
    }).toEqual({
      types: 3,
      callables: 5,
      declarations: 13,
      scopes: 12,
      statements: 13,
      controlFlows: 2,
      delimiters: 28,
    });
    expect([...structure.callables.values()].flatMap((callable) => callable.parameters.map((parameter) => ({
      callableId: callable.id,
      name: parameter.name,
      access: parameter.access,
      modifiers: parameter.modifiers,
    })))).toEqual([
      {
        callableId: "callable:file:///workspace/full.slang:5:8",
        name: "value",
        access: "read",
        modifiers: [],
      },
      {
        callableId: "callable:file:///workspace/full.slang:12:8",
        name: "value",
        access: "read",
        modifiers: ["in"],
      },
      {
        callableId: "callable:file:///workspace/full.slang:26:8",
        name: "value",
        access: "write",
        modifiers: ["out"],
      },
      {
        callableId: "callable:file:///workspace/full.slang:33:7",
        name: "uv",
        access: "readwrite",
        modifiers: ["inout"],
      },
      {
        callableId: "callable:file:///workspace/full.slang:33:7",
        name: "weight",
        access: "read",
        modifiers: ["nointerpolation"],
      },
      {
        callableId: "callable:file:///workspace/full.slang:45:7",
        name: "uv",
        access: "read",
        modifiers: [],
      },
    ]);
    expect(structure.diagnostics).toEqual([]);
  });

  // Mutation caught: matching only braces, treating generic angles as comparisons, or assigning every block to the module scope.
  it("matches structural delimiters and creates nested lexical scopes", () => {
    const structure = parse("file:///workspace/scopes.slang", "struct Pair<T> {\n"
      + "  float run() {\n"
      + "    {\n"
      + "      return values[(1 + 2)];\n"
      + "    }\n"
      + "  }\n"
      + "}\n");

    expect([...structure.delimiters.values()].map((delimiter) => ({
      kind: delimiter.kind,
      range: delimiter.range,
    }))).toEqual(expect.arrayContaining([
      {
        kind: "generic",
        range: { start: { line: 0, character: 11 }, end: { line: 0, character: 14 } },
      },
      {
        kind: "brace",
        range: { start: { line: 0, character: 15 }, end: { line: 6, character: 1 } },
      },
      {
        kind: "parenthesis",
        range: { start: { line: 1, character: 11 }, end: { line: 1, character: 13 } },
      },
      {
        kind: "brace",
        range: { start: { line: 1, character: 14 }, end: { line: 5, character: 3 } },
      },
      {
        kind: "brace",
        range: { start: { line: 2, character: 4 }, end: { line: 4, character: 5 } },
      },
      {
        kind: "bracket",
        range: { start: { line: 3, character: 19 }, end: { line: 3, character: 28 } },
      },
      {
        kind: "parenthesis",
        range: { start: { line: 3, character: 20 }, end: { line: 3, character: 27 } },
      },
    ]));
    expect([...structure.scopes.values()].map((scope) => ({
      id: scope.id,
      kind: scope.kind,
      range: scope.range,
      parentId: scope.parentId,
    }))).toEqual([
      {
        id: "scope:file:///workspace/scopes.slang:0:0",
        kind: "module",
        range: { start: { line: 0, character: 0 }, end: { line: 7, character: 0 } },
        parentId: null,
      },
      {
        id: "scope:file:///workspace/scopes.slang:0:15",
        kind: "type",
        range: { start: { line: 0, character: 15 }, end: { line: 6, character: 1 } },
        parentId: "scope:file:///workspace/scopes.slang:0:0",
      },
      {
        id: "scope:file:///workspace/scopes.slang:1:14",
        kind: "callable",
        range: { start: { line: 1, character: 14 }, end: { line: 5, character: 3 } },
        parentId: "scope:file:///workspace/scopes.slang:0:15",
      },
      {
        id: "scope:file:///workspace/scopes.slang:2:4",
        kind: "block",
        range: { start: { line: 2, character: 4 }, end: { line: 4, character: 5 } },
        parentId: "scope:file:///workspace/scopes.slang:1:14",
      },
    ]);
    expect(structure.diagnostics).toEqual([]);
  });

  // Mutation caught: stopping a callable signature at a newline or pairing only the first generic closer truncates the explicit type.
  it("preserves multiline signatures and nested generic parameter types", () => {
    const structure = parse("file:///workspace/multiline.slang", "float4\n"
      + "transform<T : IFoo,\n"
      + "  U>(\n"
      + "  Pair<Vector<float>, float> value\n"
      + ") {\n"
      + "  return float4(value);\n"
      + "}\n");

    expect([...structure.callables.values()].map((callable) => ({
      id: callable.id,
      genericParameters: callable.genericParameters,
      signatureRange: callable.signatureRange,
      bodyRange: callable.bodyRange,
      parameters: callable.parameters.map((parameter) => ({
        name: parameter.name,
        typeName: parameter.typeName,
        range: parameter.range,
        statementRange: parameter.statementRange,
      })),
    }))).toEqual([
      {
        id: "callable:file:///workspace/multiline.slang:1:0",
        genericParameters: ["T : IFoo", "U"],
        signatureRange: { start: { line: 0, character: 0 }, end: { line: 4, character: 2 } },
        bodyRange: { start: { line: 4, character: 2 }, end: { line: 6, character: 1 } },
        parameters: [
          {
            name: "value",
            typeName: "Pair<Vector<float>, float>",
            range: { start: { line: 3, character: 29 }, end: { line: 3, character: 34 } },
            statementRange: { start: { line: 3, character: 2 }, end: { line: 3, character: 34 } },
          },
        ],
      },
    ]);
    expect([...structure.delimiters.values()].filter((delimiter) => delimiter.kind === "generic").map((delimiter) => delimiter.range))
      .toEqual(expect.arrayContaining([
        { start: { line: 1, character: 9 }, end: { line: 2, character: 4 } },
        { start: { line: 3, character: 6 }, end: { line: 3, character: 28 } },
        { start: { line: 3, character: 13 }, end: { line: 3, character: 20 } },
      ]));
    expect(structure.diagnostics).toEqual([]);
  });

  // Mutation caught: parsing the raw document instead of active non-trivia tokens creates fake callables and scopes.
  it("ignores inactive declarations and function-shaped comments and strings", () => {
    const structure = parse("file:///workspace/fakes.slang", "#if 0\n"
      + "float inactive() { return 0; }\n"
      + "#endif\n"
      + "// float commented() { return 0; }\n"
      + "float live() {\n"
      + "  string text = \"float fake() { return 0; }\";\n"
      + "  return 1;\n"
      + "}\n");

    expect([...structure.callables.values()].map((callable) => callable.name)).toEqual(["live"]);
    expect([...structure.scopes.values()].map((scope) => scope.id)).toEqual([
      "scope:file:///workspace/fakes.slang:0:0",
      "scope:file:///workspace/fakes.slang:4:13",
    ]);
    expect([...structure.declarations.values()].map((declaration) => declaration.name)).toEqual(["text"]);
    expect(structure.diagnostics).toEqual([]);
  });

  // Mutation caught: dropping an unmatched opening brace silently invents a complete callable body.
  it("diagnoses unmatched opening delimiters at the physical token range", () => {
    const structure = parse("file:///workspace/unclosed-brace.slang", "float broken() {\n  return 1;\n");

    expect(structure.callables.size).toBe(0);
    expect(structure.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unmatched opening '{' delimiter.",
        sourceUri: "file:///workspace/unclosed-brace.slang",
        range: { start: { line: 0, character: 15 }, end: { line: 0, character: 16 } },
      },
    ]);
  });

  // Mutation caught: ignoring an unmatched closing token lets malformed scope syntax pass without a range-bearing diagnostic.
  it("diagnoses unmatched closing delimiters without inventing a scope", () => {
    const structure = parse("file:///workspace/unmatched-close.slang", "}\n");

    expect(structure.scopes.size).toBe(1);
    expect(structure.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unmatched closing '}' delimiter.",
        sourceUri: "file:///workspace/unmatched-close.slang",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ]);
  });

  // Mutation caught: diagnosing every nested expansion leaks expression-only macro concerns into the structural layer.
  it("diagnoses unsupported declaration expansion without diagnosing nested expression expansion", () => {
    const structure = parse("file:///workspace/recursive-macro.slang", "#define DECL(name) float name\n"
      + "#define LOOP(name) float name; LOOP(name)\n"
      + "#define WRAP(name) DECL(name)\n"
      + "#define EXPR(x) ((x) + 1)\n"
      + "#define WRAP_EXPR(x) EXPR(x)\n"
      + "LOOP(bad);\n"
      + "WRAP(hidden);\n"
      + "WRAP_EXPR(value);\n"
      + "DECL(good);\n");

    expect([...structure.declarations.values()].map((declaration) => ({
      name: declaration.name,
      typeName: declaration.typeName,
      origin: declaration.origin,
    }))).toEqual([
      {
        name: "good",
        typeName: "float",
        origin: {
          kind: "macro-invocation",
          writableRange: { start: { line: 8, character: 0 }, end: { line: 8, character: 10 } },
        },
      },
    ]);
    expect(structure.diagnostics).toEqual([
      {
        code: "slang-debug-no-writable-origin",
        message: "Macro expansion for LOOP has no writable declaration origin.",
        sourceUri: "file:///workspace/recursive-macro.slang",
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 9 } },
      },
      {
        code: "slang-debug-no-writable-origin",
        message: "Macro expansion for DECL has no writable declaration origin.",
        sourceUri: "file:///workspace/recursive-macro.slang",
        range: { start: { line: 6, character: 0 }, end: { line: 6, character: 12 } },
      },
    ]);
  });

  // Mutation caught: keying declarations by name merges a parameter with same-named locals across lexical scopes.
  it("keeps a parameter and local shadows as separate stable declarations", () => {
    const structure = parse("file:///workspace/parameter-shadow.slang", "float f(float x) {\n"
      + "  float x = 1;\n"
      + "  {\n"
      + "    float x = 2;\n"
      + "  }\n"
      + "}\n");

    expect([...structure.declarations.values()].map((declaration) => ({
      id: declaration.id,
      name: declaration.name,
      scopeId: declaration.scopeId,
      range: declaration.range,
    }))).toEqual([
      {
        id: "declaration:file:///workspace/parameter-shadow.slang:1:8",
        name: "x",
        scopeId: "scope:file:///workspace/parameter-shadow.slang:0:17",
        range: { start: { line: 1, character: 8 }, end: { line: 1, character: 9 } },
      },
      {
        id: "declaration:file:///workspace/parameter-shadow.slang:3:10",
        name: "x",
        scopeId: "scope:file:///workspace/parameter-shadow.slang:2:2",
        range: { start: { line: 3, character: 10 }, end: { line: 3, character: 11 } },
      },
      {
        id: "declaration:file:///workspace/parameter-shadow.slang:0:14",
        name: "x",
        scopeId: "scope:file:///workspace/parameter-shadow.slang:0:17",
        range: { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } },
      },
    ]);
    expect(structure.diagnostics).toEqual([]);
  });

  // Mutation caught: assigning a for initializer to its callable leaks the declaration after the loop completes.
  it("records a complete for-loop scope containing its initializer and body", () => {
    const structure = parse("file:///workspace/for-init.slang", "float f() {\n"
      + "  for (int i = 0; i < 2; i++) {\n"
      + "    return i;\n"
      + "  }\n"
      + "}\n");

    expect([...structure.declarations.values()].map((declaration) => ({
      id: declaration.id,
      name: declaration.name,
      typeName: declaration.typeName,
      range: declaration.range,
      statementRange: declaration.statementRange,
      scopeId: declaration.scopeId,
    }))).toEqual([
      {
        id: "declaration:file:///workspace/for-init.slang:1:11",
        name: "i",
        typeName: "int",
        range: { start: { line: 1, character: 11 }, end: { line: 1, character: 12 } },
        statementRange: { start: { line: 1, character: 7 }, end: { line: 1, character: 17 } },
        scopeId: "scope:file:///workspace/for-init.slang:1:2",
      },
    ]);
    expect([...structure.scopes.values()].map((scope) => ({
      id: scope.id,
      kind: scope.kind,
      range: scope.range,
      parentId: scope.parentId,
    }))).toEqual([
      {
        id: "scope:file:///workspace/for-init.slang:0:0",
        kind: "module",
        range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
        parentId: null,
      },
      {
        id: "scope:file:///workspace/for-init.slang:0:10",
        kind: "callable",
        range: { start: { line: 0, character: 10 }, end: { line: 4, character: 1 } },
        parentId: "scope:file:///workspace/for-init.slang:0:0",
      },
      {
        id: "scope:file:///workspace/for-init.slang:1:30",
        kind: "block",
        range: { start: { line: 1, character: 30 }, end: { line: 3, character: 3 } },
        parentId: "scope:file:///workspace/for-init.slang:1:2",
      },
      {
        id: "scope:file:///workspace/for-init.slang:1:2",
        kind: "loop",
        range: { start: { line: 1, character: 2 }, end: { line: 3, character: 3 } },
        parentId: "scope:file:///workspace/for-init.slang:0:10",
      },
    ]);
    expect(structure.diagnostics).toEqual([]);
  });

  // Mutations caught: treating expressions as declarations, flattening array types to scalars, retaining comments,
  // or silently choosing one name from a comma-separated declarator list.
  it("accepts only bounded explicit declarations and preserves array/trivia boundaries", () => {
    const structure = parse("file:///workspace/declarations.slang", "float f() {\n"
      + "  object.field;\n"
      + "  a + b;\n"
      + "  float values[4];\n"
      + "  float left, right;\n"
      + "  float /*note*/ value;\n"
      + "}\n");

    expect([...structure.declarations.values()].map((declaration) => ({
      name: declaration.name,
      typeName: declaration.typeName,
      range: declaration.range,
    }))).toEqual([
      {
        name: "values",
        typeName: "float[4]",
        range: { start: { line: 3, character: 8 }, end: { line: 3, character: 14 } },
      },
      {
        name: "value",
        typeName: "float",
        range: { start: { line: 5, character: 17 }, end: { line: 5, character: 22 } },
      },
    ]);
    expect(structure.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Multiple declarators in one statement are unsupported.",
        sourceUri: "file:///workspace/declarations.slang",
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 20 } },
      },
    ]);
  });

  // Mutation caught: globally guessing angle pairs either turns comparisons into generics or pairs a later comparison with a broken header.
  it("diagnoses confident unmatched declaration generics without pairing comparisons", () => {
    const structure = parse("file:///workspace/generics.slang", "struct Broken<T {\n"
      + "}\n"
      + "float compare(float a, float b, float c) {\n"
      + "  bool value = a < b > c;\n"
      + "  bool compact = a<b>c;\n"
      + "  Pair< float > spaced;\n"
      + "  return value;\n"
      + "}\n");

    expect([...structure.delimiters.values()].filter((delimiter) => delimiter.kind === "generic").map((delimiter) => delimiter.range))
      .toEqual([
        { start: { line: 5, character: 6 }, end: { line: 5, character: 15 } },
      ]);
    expect(structure.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unmatched generic '<' delimiter.",
        sourceUri: "file:///workspace/generics.slang",
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 14 } },
      },
    ]);
  });

  // Mutation caught: requiring braced bodies drops legal control flow and ending do at its body omits the while condition.
  it("ranges unbraced controls and the complete do-while statement", () => {
    const structure = parse("file:///workspace/unbraced-controls.slang", "float f(bool test) {\n"
      + "  if (test) return 1;\n"
      + "  for (int i = 0; i < 1; i++) continue;\n"
      + "  while (test) break;\n"
      + "  do test = false; while (test);\n"
      + "}\n");

    expect([...structure.controlFlows.values()].map((control) => ({
      kind: control.kind,
      range: control.range,
    }))).toEqual([
      { kind: "if", range: { start: { line: 1, character: 2 }, end: { line: 1, character: 21 } } },
      { kind: "for", range: { start: { line: 2, character: 2 }, end: { line: 2, character: 39 } } },
      { kind: "while", range: { start: { line: 3, character: 2 }, end: { line: 3, character: 21 } } },
      { kind: "do", range: { start: { line: 4, character: 2 }, end: { line: 4, character: 32 } } },
    ]);
    expect([...structure.statements.values()].map((statement) => ({
      kind: statement.kind,
      range: statement.range,
      scopeId: statement.scopeId,
    })).sort((left, right) => left.range.start.line - right.range.start.line
      || left.range.start.character - right.range.start.character)).toEqual([
      {
        kind: "return",
        range: { start: { line: 1, character: 12 }, end: { line: 1, character: 21 } },
        scopeId: "scope:file:///workspace/unbraced-controls.slang:0:19",
      },
      {
        kind: "declaration",
        range: { start: { line: 2, character: 7 }, end: { line: 2, character: 17 } },
        scopeId: "scope:file:///workspace/unbraced-controls.slang:2:2",
      },
      {
        kind: "continue",
        range: { start: { line: 2, character: 30 }, end: { line: 2, character: 39 } },
        scopeId: "scope:file:///workspace/unbraced-controls.slang:2:2",
      },
      {
        kind: "break",
        range: { start: { line: 3, character: 15 }, end: { line: 3, character: 21 } },
        scopeId: "scope:file:///workspace/unbraced-controls.slang:0:19",
      },
      {
        kind: "expression",
        range: { start: { line: 4, character: 5 }, end: { line: 4, character: 18 } },
        scopeId: "scope:file:///workspace/unbraced-controls.slang:0:19",
      },
    ]);
  });

  // Mutation caught: hard-coding empty type metadata drops source attributes/modifiers and starts the type range too late.
  it("retains type attributes and modifiers before a generic declaration", () => {
    const structure = parse("file:///workspace/type-metadata.slang", "[Reflectable]\n"
      + "public struct S<T> {\n"
      + "}\n");

    expect([...structure.types.values()].map((type) => ({
      kind: type.kind,
      name: type.name,
      attributes: type.attributes,
      modifiers: type.modifiers,
      range: type.range,
    }))).toEqual([
      {
        kind: "struct",
        name: "S",
        attributes: ["Reflectable"],
        modifiers: ["public"],
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
      },
    ]);
    expect(structure.diagnostics).toEqual([]);
  });
});

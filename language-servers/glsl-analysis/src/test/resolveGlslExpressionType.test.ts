import { describe, expect, it } from "vitest";
import { buildGlslAuthoringPreamble, type ShaderAuthoringEnvironment } from "@shader-studio/types";
import { parseGlslDocument, resolveGlslExpressionType, glslVectorTypeName } from "../index";
import {
  arrayQuantifierDimensions,
  extractDeclarationMetadata,
  extractTypeName,
  publicTypeName,
  resolveExpressionType,
  withArrayDimensions,
} from "../GlslExpressionTypes";
import { createDiagnostic, mapGeneratedLocation, mapIdentifierLocation, mapLocation, sourceRange } from "../GlslSourceMapping";

const uri = "file:///workspace/image.glsl";

function request(source: string, expression: string, line: number, character: number) {
  return { uri, source, stage: "fragment" as const, position: { line, character }, expression };
}

const shader = `struct Material { vec3 albedo; float rough; };
vec3 palette(float t) { return vec3(t); }
void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  Material m;
  vec3 points[4];
  mat3 basis;
  uv.
  color = vec4(uv, 0.0, 1.0);
}`;

const cursor = { line: 7, character: 5 };

describe("resolveGlslExpressionType", () => {
  it("resolves a local vector variable while the member selection is still incomplete", () => {
    const resolved = resolveGlslExpressionType(request(shader, "uv", cursor.line, cursor.character));

    expect(resolved).toEqual({ name: "vec2", vector: { componentType: "float", size: 2 } });
  });

  it("resolves struct variables to their declared fields", () => {
    const resolved = resolveGlslExpressionType(request(shader, "m", cursor.line, cursor.character));

    expect(resolved).toEqual({
      name: "Material",
      fields: [{ name: "albedo", type: "vec3" }, { name: "rough", type: "float" }],
    });
  });

  it("walks field selections, swizzles, and index suffixes", () => {
    const resolve = (expression: string) => resolveGlslExpressionType(request(shader, expression, cursor.line, cursor.character))?.name;

    expect(resolve("m.albedo")).toBe("vec3");
    expect(resolve("uv.x")).toBe("float");
    expect(resolve("uv.yx")).toBe("vec2");
    expect(resolve("points[0]")).toBe("vec3");
    expect(resolve("basis[1]")).toBe("vec3");
    expect(resolve("m.albedo.rg")).toBe("vec2");
  });

  it.each(["uv.xxxx", "m.albedo.yxzz", "m.albedo.grrr"])("resolves valid swizzles omitted from suggestions: %s", (expression) => {
    expect(resolveGlslExpressionType(request(shader, expression, cursor.line, cursor.character))?.name).toBe("vec4");
  });

  it("resolves calls to local functions and built-in constructors", () => {
    const resolve = (expression: string) => resolveGlslExpressionType(request(shader, expression, cursor.line, cursor.character))?.name;

    expect(resolve("palette(0.5)")).toBe("vec3");
    expect(resolve("vec4(uv, 0.0, 1.0)")).toBe("vec4");
    expect(resolve("ivec2(1, 2)")).toBe("ivec2");
  });

  it("resolves parser arithmetic, matrix, and conditional nodes", () => {
    const resolve = (expression: Record<string, unknown>) => resolveExpressionType([], new Map(), [], expression);
    const bool = { type: "bool_constant" };
    const int = { type: "int_constant" };
    const uint = { type: "uint_constant" };
    const float = { type: "float_constant" };
    const vector = { type: "function_call", identifier: { identifier: "vec2" }, args: [] };
    const integerVector = { type: "function_call", identifier: { identifier: "ivec2" }, args: [] };
    const matrix = { type: "function_call", identifier: { identifier: "mat2" }, args: [] };
    const binary = (operator: string, left: Record<string, unknown>, right: Record<string, unknown>) => ({
      type: "binary", operator: { literal: operator }, left, right,
    });

    expect(resolve({ type: "unary", operator: { literal: "!" }, expression: bool })).toBe("bool");
    expect(resolve({ type: "unary", operator: { literal: "~" }, expression: uint })).toBe("uint");
    expect(resolve({ type: "unary", expression: uint })).toBeUndefined();
    expect(resolve(binary("&&", bool, bool))).toBe("bool");
    expect(resolve(binary("==", int, int))).toBe("bool");
    expect(resolve(binary("<", int, int))).toBe("bool");
    expect(resolve(binary("+", vector, float))).toBe("vec2");
    expect(resolve(binary("&", integerVector, int))).toBe("ivec2");
    expect(resolve(binary("&", int, integerVector))).toBe("ivec2");
    expect(resolve(binary("<<", integerVector, integerVector))).toBe("ivec2");
    expect(resolve(binary("<<", int, integerVector))).toBeUndefined();
    expect(resolve(binary("%", int, int))).toBe("int");
    expect(resolve(binary("*", matrix, matrix))).toBe("mat2");
    expect(resolve(binary("*", matrix, vector))).toBe("vec2");
    expect(resolve(binary("*", vector, matrix))).toBe("vec2");
    expect(resolve(binary("*", matrix, float))).toBe("mat2");
    expect(resolve(binary("*", float, matrix))).toBe("mat2");
    expect(resolve({ type: "ternary", expression: bool, left: vector, right: vector })).toBe("vec2");
    expect(resolve(binary("*", matrix, { type: "function_call", identifier: { identifier: "vec3" }, args: [] }))).toBeUndefined();
    expect(resolve({ type: "ternary", expression: int, left: vector, right: vector })).toBeUndefined();
  });

  it("normalizes parser declaration and array type metadata", () => {
    expect(extractTypeName(null)).toBeUndefined();
    expect(extractTypeName({ type: "type_name", identifier: "Material" })).toBe("Material");
    expect(extractTypeName({ type: "struct", typeName: { identifier: "Inline" } })).toBe("Inline");
    expect(extractDeclarationMetadata({ type: "struct", location: { start: { offset: 3 }, end: { offset: 8 } } }))
      .toEqual({ typeName: undefined, resolvedTypeName: "@anonymous-struct:3:8" });
    expect(withArrayDimensions({ resolvedTypeName: "float" }, [4, undefined])).toEqual({
      resolvedTypeName: "@array:4,?:float",
    });
    expect(arrayQuantifierDimensions({
      specifier: { quantifier: { expression: { type: "int_constant", token: "0x10u" } } },
      quantifier: [{ expression: { type: "int_constant", token: "bad" } }],
    })).toEqual([16, undefined]);
    expect(publicTypeName("float[0x10][bad]")).toBe("float[16][]");
    expect(publicTypeName("@array:nope:float")).toBe("@array:nope:float");
    expect(publicTypeName("@anonymous-struct:3:8")).toBe("anonymous struct");
  });

  it("maps identifier and generated parser ranges back to authored source", () => {
    const singleLine = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 4, offset: 3 },
    };
    const multiLine = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 2, column: 2, offset: 5 },
    };

    expect(mapIdentifierLocation(singleLine, "not an identifier", ["value"], ["value"], [0], new Map()))
      .toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
    expect(mapIdentifierLocation(singleLine, "missing", ["value"], ["value"], [0], new Map())).toBeUndefined();
    expect(mapGeneratedLocation(multiLine, ["first", "second"], ["first", "second"], [0, 1], new Map()))
      .toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 1 } });
    expect(mapGeneratedLocation(singleLine, ["call(value)"], ["call(value)"], [0], new Map()))
      .toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
    expect(mapLocation(undefined, ["first", "second"], ["first", "second"]))
      .toEqual(sourceRange(["first", "second"]));
    expect(createDiagnostic("syntax", "plain parser failure", ["source"]))
      .toMatchObject({ code: "syntax", message: "plain parser failure", range: { start: { line: 0, character: 0 } } });
  });

  it("resolves names and functions supplied by the host environment", () => {
    const context = {
      variableType: (name: string) => (name === "iResolution" ? "vec3" : undefined),
      functionType: (name: string) => (name === "texture" ? "vec4" : undefined),
    };

    expect(resolveGlslExpressionType(request(shader, "iResolution", cursor.line, cursor.character), context)?.name).toBe("vec3");
    expect(resolveGlslExpressionType(request(shader, "texture(sky, uv)", cursor.line, cursor.character), context)?.name).toBe("vec4");
  });

  it("resolves struct types declared by included documents", () => {
    const include = parseGlslDocument(
      "file:///workspace/common.glsl",
      "struct Light { vec3 color; float power; };\nLight keyLight;",
      "fragment",
    );
    const resolved = resolveGlslExpressionType(request(shader, "keyLight", cursor.line, cursor.character), { includes: [include] });

    expect(resolved).toEqual({
      name: "Light",
      fields: [{ name: "color", type: "vec3" }, { name: "power", type: "float" }],
    });
  });

  it("resolves channel metadata types from the generated GLSL preamble", () => {
    const environment: ShaderAuthoringEnvironment = {
      documentUri: uri,
      languageId: "glsl",
      generation: 1,
      passName: "Image",
      stage: "fragment",
      customUniforms: [],
      resources: [{ name: "sky", kind: "texture-cube", slot: 0 }],
      virtualFiles: [],
    };
    const generated = buildGlslAuthoringPreamble(environment);
    const includes = [parseGlslDocument(generated.uri, generated.text, environment.stage)];

    expect(resolveGlslExpressionType(request(shader, "iCh0", cursor.line, cursor.character), { includes })?.fields)
      .toEqual(expect.arrayContaining([
        { name: "sampler", type: "samplerCube" },
        { name: "size", type: "vec3" },
        { name: "time", type: "float" },
        { name: "loaded", type: "int" },
      ]));
    expect(resolveGlslExpressionType(request(shader, "iCh0.size", cursor.line, cursor.character), { includes })?.name)
      .toBe("vec3");
  });

  it("resolves a selection dangling at the end of a block", () => {
    const dangling = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  color = vec4(uv, 0.0, 1.0);
  uv.
}`;

    expect(resolveGlslExpressionType(request(dangling, "uv", 3, 5))?.name).toBe("vec2");
  });

  it("resolves a selection typed inside a call argument", () => {
    const inCall = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  color = vec4(uv., 0.0, 1.0);
}`;

    expect(resolveGlslExpressionType(request(inCall, "uv", 2, 17))?.name).toBe("vec2");
  });

  it("resolves a selection typed inside a condition", () => {
    const inCondition = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  if (uv. > 0.5) { color = vec4(1.0); }
}`;

    expect(resolveGlslExpressionType(request(inCondition, "uv", 2, 9))?.name).toBe("vec2");
  });

  it("reports nothing for expressions it cannot type", () => {
    const resolve = (expression: string) => resolveGlslExpressionType(request(shader, expression, cursor.line, cursor.character));

    expect(resolve("missing")).toBeUndefined();
    expect(resolve("uv.q")).toBeUndefined();
    expect(resolve("m.missing")).toBeUndefined();
    expect(resolve("(uv + coord)")).toBeUndefined();
    expect(resolve("palette")).toBeUndefined();
    expect(resolve("")).toBeUndefined();
  });

  it("reports matrix and scalar types without members", () => {
    const resolve = (expression: string) => resolveGlslExpressionType(request(shader, expression, cursor.line, cursor.character));

    expect(resolve("basis")).toEqual({ name: "mat3" });
    expect(resolve("uv.x")).toEqual({ name: "float" });
  });
});

describe("glslVectorTypeName", () => {
  it("names vectors for each component type", () => {
    expect(glslVectorTypeName("float", 3)).toBe("vec3");
    expect(glslVectorTypeName("bool", 2)).toBe("bvec2");
    expect(glslVectorTypeName("int", 4)).toBe("ivec4");
    expect(glslVectorTypeName("uint", 2)).toBe("uvec2");
    expect(glslVectorTypeName("double", 3)).toBe("dvec3");
    expect(glslVectorTypeName("Material", 2)).toBeUndefined();
  });
});

describe("resolveGlslExpressionType in complete documents", () => {
  it("resolves a member in an if header followed by an else-if chain", () => {
    const source = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  if (uv.y >= 0.5 && uv.x < 0.5) {
    color = vec4(1.0);
  } else if (uv.y >= 0.5) {
    color = vec4(0.5);
  }
}`;
    const line = 2;
    const character = source.split("\n")[line]!.indexOf("uv.y") + "uv.".length;
    expect(resolveGlslExpressionType(request(source, "uv", line, character))).toEqual({
      name: "vec2", vector: { componentType: "float", size: 2 },
    });
  });
});

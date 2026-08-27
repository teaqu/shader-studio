import { describe, expect, it } from "vitest";
import { parseGlslDocument, resolveGlslExpressionType, glslVectorTypeName } from "../index";

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

  it("resolves calls to local functions and built-in constructors", () => {
    const resolve = (expression: string) => resolveGlslExpressionType(request(shader, expression, cursor.line, cursor.character))?.name;

    expect(resolve("palette(0.5)")).toBe("vec3");
    expect(resolve("vec4(uv, 0.0, 1.0)")).toBe("vec4");
    expect(resolve("ivec2(1, 2)")).toBe("ivec2");
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

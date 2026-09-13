import { describe, expect, it } from "vitest";
import { resolveWgslExpressionType } from "../expressionType";

const URI = "file:///workspace/image.wgsl";

const SOURCE = [
  "struct Light { color: vec3f, power: f32, }",
  "var<private> light: Light;",
  "var<private> uv: vec2f;",
  "fn shade(c: vec3f) -> vec3f {",
  "  return c;",
  "}",
].join("\n");

describe("resolveWgslExpressionType", () => {
  it("resolves a global variable to its declared type", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "uv",
    })).toMatchObject({ name: "vec2f", vector: { componentType: "f32", size: 2 } });
  });

  it("resolves struct member access to the field type", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "light.color",
    })).toMatchObject({ name: "vec3f" });
  });

  it("resolves swizzle selections on vectors", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "uv.xy",
    })).toMatchObject({ name: "vec2f" });
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "uv.x",
    })).toMatchObject({ name: "f32" });
  });

  it("resolves builtin constructor calls and indexed elements", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "vec3f(1.0)",
    })).toMatchObject({ name: "vec3f" });
    expect(resolveWgslExpressionType({
      uri: URI,
      source: "var<private> values: array<f32, 4>;\nfn f() -> f32 { return 1.0; }",
      stage: "fragment",
      position: { line: 1, character: 0 },
      expression: "values[0]",
    })).toMatchObject({ name: "f32" });
  });

  it("resolves declared function return types", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "shade(uv)",
    })).toMatchObject({ name: "vec3f" });
  });

  it("returns undefined for unknown names and empty expressions", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "mysterious",
    })).toBeUndefined();
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "",
    })).toBeUndefined();
  });

  it("falls back to context-provided host types", () => {
    expect(resolveWgslExpressionType(
      {
        uri: URI,
        source: "fn f() -> f32 { return 1.0; }",
        stage: "fragment",
        position: { line: 0, character: 0 },
        expression: "iTime",
      },
      { variableType: (name) => (name === "iTime" ? "f32" : undefined) },
    )).toMatchObject({ name: "f32" });
    expect(resolveWgslExpressionType(
      {
        uri: URI,
        source: "fn f() -> f32 { return 1.0; }",
        stage: "fragment",
        position: { line: 0, character: 0 },
        expression: "textureSample(t, s, uv)",
      },
      { functionType: (name) => (name === "textureSample" ? "vec4f" : undefined) },
    )).toMatchObject({ name: "vec4f" });
  });

  it("reports struct fields for member completion", () => {
    expect(resolveWgslExpressionType({
      uri: URI,
      source: SOURCE,
      stage: "fragment",
      position: { line: 5, character: 0 },
      expression: "light",
    })).toMatchObject({
      name: "Light",
      fields: [
        { name: "color", type: "vec3f" },
        { name: "power", type: "f32" },
      ],
    });
  });

  it("preserves vector swizzles and struct fields through aliases", () => {
    const source = [
      "alias Tint = vec4f;",
      "struct Light { color: vec3f, }",
      "alias KeyLight = Light;",
      "fn main() {",
      "  var tint: Tint;",
      "  var key: KeyLight;",
      "  let output = tint;",
      "  let lit = key;",
      "}",
    ].join("\n");
    expect(resolveWgslExpressionType({ uri: URI, source, stage: "fragment", position: { line: 6, character: 20 }, expression: "tint" }))
      .toMatchObject({ name: "vec4f", vector: expect.any(Object) });
    expect(resolveWgslExpressionType({ uri: URI, source, stage: "fragment", position: { line: 7, character: 13 }, expression: "key" }))
      .toMatchObject({ name: "Light", fields: [{ name: "color", type: "vec3f" }] });
  });

  it("does not loop on invalid cyclic aliases", () => {
    const source = "alias A = B; alias B = A; fn main() { var value: A; let use = value; }";
    expect(resolveWgslExpressionType({ uri: URI, source, stage: "fragment", position: { line: 0, character: 68 }, expression: "value" }))
      .toMatchObject({ name: "A" });
  });
});

describe("resolveWgslExpressionType in complete documents", () => {
  it("resolves a member in an if header followed by an else-if chain", () => {
    const source = [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let uv = coord;",
      "  if uv.y >= 0.5 && uv.x < 0.5 {",
      "    return vec4f(1.0);",
      "  } else if uv.y >= 0.5 {",
      "    return vec4f(0.5);",
      "  }",
      "  return vec4f(0.0);",
      "}",
    ].join("\n");
    const character = source.split("\n")[2]!.indexOf("uv.y") + "uv.".length;
    expect(resolveWgslExpressionType({
      uri: URI, source, stage: "fragment", position: { line: 2, character }, expression: "uv",
    })).toMatchObject({ name: "vec2f", vector: { componentType: "f32", size: 2 } });
  });
});

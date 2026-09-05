import { describe, expect, it } from "vitest";
import { buildSlangAuthoringModule, type ShaderAuthoringEnvironment } from "@shader-studio/types";
import { resolveSlangExpressionType } from "../expressionType";

const shader = `struct Material { float3 albedo; float rough; float4 tint : COLOR; float3 shade(float k) { return albedo * k; } };
float3 palette(float t) { return float3(t); }
float4 mainImage(float2 p)
{
    float2 uv = p * 0.5;
    Material m;
    float3 points[4];
    float3x4 basis;
    vector<half, 3> tinted;
    uv.
    return float4(uv, 0.0, 1.0);
}`;

const position = { line: 9, character: 7 };

function resolve(expression: string, context = {}) {
  return resolveSlangExpressionType({ source: shader, position, expression }, context);
}

describe("resolveSlangExpressionType", () => {
  it("resolves local variables and parameters to their declared types", () => {
    expect(resolve("uv")).toEqual({ name: "float2", vector: { componentType: "float", size: 2 } });
    expect(resolve("p")).toEqual({ name: "float2", vector: { componentType: "float", size: 2 } });
  });

  it("resolves struct variables to their declared fields", () => {
    expect(resolve("m")).toEqual({
      name: "Material",
      fields: [
        { name: "albedo", type: "float3" },
        { name: "rough", type: "float" },
        { name: "tint", type: "float4" },
        { name: "shade", type: "float3" },
      ],
    });
  });

  it("walks field selections, swizzles, and index suffixes", () => {
    expect(resolve("m.albedo")?.name).toBe("float3");
    expect(resolve("uv.x")?.name).toBe("float");
    expect(resolve("uv.yx")?.name).toBe("float2");
    expect(resolve("m.albedo.rg")?.name).toBe("float2");
    expect(resolve("points[1]")?.name).toBe("float3");
    expect(resolve("basis[0]")?.name).toBe("float4");
  });

  it("resolves generic vector declarations", () => {
    expect(resolve("tinted")).toEqual({ name: "half3", vector: { componentType: "half", size: 3 } });
  });

  it("resolves calls to local functions and built-in constructors", () => {
    expect(resolve("palette(0.5)")?.name).toBe("float3");
    expect(resolve("float4(uv, 0.0, 1.0)")?.name).toBe("float4");
    expect(resolve("mainImage(p)")?.name).toBe("float4");
  });

  it("resolves names and functions supplied by the host environment", () => {
    const context = {
      variableType: (name: string) => (name === "iResolution" ? "float3" : undefined),
      functionType: (name: string) => (name === "sampleTexture" ? "float4" : undefined),
    };

    expect(resolve("iResolution", context)?.name).toBe("float3");
    expect(resolve("sampleTexture(uv)", context)?.name).toBe("float4");
  });

  it("resolves declarations contributed by included sources", () => {
    const includes = ["struct Light { float3 color; float power; };\nLight keyLight;"];

    expect(resolve("keyLight", { includes })).toEqual({
      name: "Light",
      fields: [{ name: "color", type: "float3" }, { name: "power", type: "float" }],
    });
    expect(resolve("keyLight.color", { includes })?.name).toBe("float3");
  });

  it("resolves typed channel fields supplied by the generated source", () => {
    const environment: ShaderAuthoringEnvironment = {
      documentUri: "file:///image.slang",
      languageId: "slang",
      generation: 1,
      passName: "Image",
      stage: "fragment",
      customUniforms: [],
      resources: [{ name: "iChannel0", kind: "texture-2d", slot: 0 }],
      virtualFiles: [],
    };
    const includes = [buildSlangAuthoringModule(environment).text];

    expect(resolve("inputs", { includes })?.name).toBe("ShaderStudioInputs");
    expect(resolve("inputs.iChannel0", { includes })?.name).toBe("ShaderStudioChannel2D");
    expect(resolve("inputs.iChannel0.texture", { includes })?.name).toBe("Texture2D<float4>");
    expect(resolve("inputs.iChannel0.size", { includes })?.name).toBe("uint2");
  });

  it("prefers the nearest declaration that precedes the cursor", () => {
    const source = `float4 mainImage(float2 p)
{
    float4 value = float4(0.0);
    {
        float2 value = p;
        value.
    }
    return value;
}`;

    expect(resolveSlangExpressionType({ source, position: { line: 5, character: 14 }, expression: "value" })?.name)
      .toBe("float2");
  });

  it("reports nothing for expressions it cannot type", () => {
    expect(resolve("missing")).toBeUndefined();
    expect(resolve("uv.q")).toBeUndefined();
    expect(resolve("m.missing")).toBeUndefined();
    expect(resolve("(uv + p)")).toBeUndefined();
    expect(resolve("")).toBeUndefined();
  });

  it("does not mistake keywords or calls for declarations", () => {
    const source = `float4 mainImage(float2 p)
{
    return float4(p, 0.0, 1.0);
}`;

    expect(resolveSlangExpressionType({ source, position: { line: 2, character: 11 }, expression: "float4" }))
      .toBeUndefined();
    expect(resolveSlangExpressionType({ source, position: { line: 2, character: 11 }, expression: "return" }))
      .toBeUndefined();
  });

  it("describes matrix and scalar types without members", () => {
    expect(resolve("basis")).toEqual({ name: "float3x4" });
    expect(resolve("uv.x")).toEqual({ name: "float" });
  });
});

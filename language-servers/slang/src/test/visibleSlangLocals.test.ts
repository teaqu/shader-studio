import { describe, expect, it } from "vitest";
import { visibleSlangLocals } from "../expressionType";

const source = `struct Ray { float3 origin; };

float3 palette(float t, inout float3 base)
{
    float2 uv = float2(t, t);
    Ray ray;
    float samples[4];
    {
        float3 uv = float3(t);
        base = uv;
    }
    return base;
}

float other(float amount)
{
    return amount;
}`;

function at(needle: string) {
  const offset = source.indexOf(needle);
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

describe("visibleSlangLocals", () => {
  it("offers parameters and locals declared before the cursor", () => {
    const visible = visibleSlangLocals(source, at("    return base;"));

    expect(visible).toEqual(expect.arrayContaining([
      { name: "t", typeName: "float", kind: "parameter" },
      { name: "base", typeName: "float3", kind: "parameter" },
      { name: "uv", typeName: "float2", kind: "variable" },
      { name: "ray", typeName: "Ray", kind: "variable" },
    ]));
  });

  it("reports an array local by its element type with brackets", () => {
    expect(visibleSlangLocals(source, at("    return base;")))
      .toContainEqual({ name: "samples", typeName: "float[]", kind: "variable" });
  });

  it("omits a local declared after the cursor", () => {
    expect(visibleSlangLocals(source, at("    Ray ray;")).map((local) => local.name))
      .not.toContain("samples");
  });

  it("omits locals and parameters belonging to another function", () => {
    const names = visibleSlangLocals(source, at("    return amount;")).map((local) => local.name);

    expect(names).toContain("amount");
    expect(names).not.toContain("uv");
    expect(names).not.toContain("t");
  });

  it("omits a local whose block has already closed", () => {
    expect(visibleSlangLocals(source, at("    return base;")).filter((local) => local.name === "uv"))
      .toEqual([{ name: "uv", typeName: "float2", kind: "variable" }]);
  });

  it("lets an inner declaration shadow an outer one of the same name", () => {
    expect(visibleSlangLocals(source, at("        base = uv;")).filter((local) => local.name === "uv"))
      .toEqual([{ name: "uv", typeName: "float3", kind: "variable" }]);
  });

  it("offers nothing at a position the document does not contain", () => {
    expect(visibleSlangLocals(source, { line: 999, character: 0 })).toEqual([]);
    expect(visibleSlangLocals(source, { line: 0, character: 999 })).toEqual([]);
  });

  it("ignores control-flow keywords that look like declarations", () => {
    const names = visibleSlangLocals(`float loopy(float t)
{
    for (int i = 0; i < 4; i++)
    {
        t += 1.0;
    }
    return t;
}`, { line: 6, character: 4 }).map((local) => local.name);

    expect(names).toContain("t");
    expect(names).not.toContain("for");
  });

  it("offers file-scope declarations to a cursor at global scope", () => {
    expect(visibleSlangLocals(`static const float gain = 2.0;
`, { line: 1, character: 0 }))
      .toContainEqual({ name: "gain", typeName: "float", kind: "variable" });
  });
});

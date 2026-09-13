import { describe, expect, it } from "vitest";
import { findSlangLocalAt, visibleSlangLocals } from "../expressionType";

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

  it("offers an array local initialised with a brace list", () => {
    expect(visibleSlangLocals(`float blend()
{
    float weights[3] = { 0.2, 0.3, 0.5 };
    return weights[0];
}`, { line: 3, character: 4 })).toContainEqual({ name: "weights", typeName: "float[]", kind: "variable" });
  });

  it("offers parameters declared with semantics, defaults and array brackets", () => {
    const visible = visibleSlangLocals(`void computeMain(uint3 tid : SV_DispatchThreadID, in uint index : SV_GroupIndex, float weights[4], float gain = 1.0)
{
    return;
}`, { line: 2, character: 4 });

    expect(visible).toEqual(expect.arrayContaining([
      { name: "tid", typeName: "uint3", kind: "parameter" },
      { name: "index", typeName: "uint", kind: "parameter" },
      { name: "weights", typeName: "float[]", kind: "parameter" },
      { name: "gain", typeName: "float", kind: "parameter" },
    ]));
  });
});

describe("findSlangLocalAt", () => {
  const shader = `void computeMain(uint3 tid : SV_DispatchThreadID)
{
    float2 uv = float2(tid.xy);
    {
        float3 uv = float3(1.0);
        uv.x;
    }
    later();
}`;

  function at(needle: string, occurrence = 0) {
    let offset = -1;
    for (let index = 0; index <= occurrence; index++) {
      offset = shader.indexOf(needle, offset + 1);
    }
    const lines = shader.slice(0, offset).split("\n");
    return { line: lines.length - 1, character: lines.at(-1)!.length };
  }

  it("finds a parameter at its declaration and at a reference", () => {
    expect(findSlangLocalAt(shader, at("tid"))).toEqual({ name: "tid", typeName: "uint3", kind: "parameter" });
    expect(findSlangLocalAt(shader, at("tid", 1))).toEqual({ name: "tid", typeName: "uint3", kind: "parameter" });
  });

  it("finds a local at its declaration and the innermost one at a shadowed reference", () => {
    expect(findSlangLocalAt(shader, at("uv"))).toEqual({ name: "uv", typeName: "float2", kind: "variable" });
    expect(findSlangLocalAt(shader, at("uv", 1))).toEqual({ name: "uv", typeName: "float3", kind: "variable" });
    expect(findSlangLocalAt(shader, at("uv.x"))).toEqual({ name: "uv", typeName: "float3", kind: "variable" });
  });

  it("finds a reference that follows a comment ending in a full stop", () => {
    const source = "float4 mainImage(float2 p)\n{\n    float3 prev = float3(p, 0.0);\n    // Decay old ink.\n    prev *= 0.985;\n    return float4(prev, 1.0);\n}";
    expect(findSlangLocalAt(source, { line: 4, character: 5 })).toEqual({ name: "prev", typeName: "float3", kind: "variable" });
  });

  it("finds nothing for member selections, calls, keywords or positions outside a word", () => {
    expect(findSlangLocalAt(shader, at("xy"))).toBeUndefined();
    expect(findSlangLocalAt(shader, at("later"))).toBeUndefined();
    expect(findSlangLocalAt(shader, at("float2 uv"))).toBeUndefined();
    expect(findSlangLocalAt(shader, { line: 1, character: 0 })).toBeUndefined();
    expect(findSlangLocalAt(shader, { line: 99, character: 0 })).toBeUndefined();
  });
});

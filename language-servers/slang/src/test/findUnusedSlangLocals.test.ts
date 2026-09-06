import { describe, expect, it } from "vitest";
import { findUnusedSlangLocals } from "../expressionType";

describe("findUnusedSlangLocals", () => {
  it("reports an unread local while accepting a read one", () => {
    const source = `float4 mainImage(float2 p)
{
    float read = p.x * 2.0;
    float unread = p.y * 3.0;
    return float4(read, 0.0, 1.0);
}`;
    const unused = findUnusedSlangLocals(source);

    expect(unused).toEqual([
      { name: "unread", kind: "variable", range: { start: { line: 3, character: 10 }, end: { line: 3, character: 16 } } },
    ]);
  });

  it("reports an unused parameter while accepting a used one", () => {
    const source = `float helper(float used, float unusedParam)
{
    return used;
}`;
    const unused = findUnusedSlangLocals(source);

    expect(unused).toEqual([
      {
        name: "unusedParam",
        kind: "parameter",
        range: { start: { line: 0, character: 31 }, end: { line: 0, character: 42 } },
      },
    ]);
  });

  it("counts an assignment as a use", () => {
    const source = `float4 mainImage(float2 p, out float written)
{
    written = p.x;
    return float4(p, 0.0, 1.0);
}`;

    expect(findUnusedSlangLocals(source)).toEqual([]);
  });

  it("attributes a shadowed use to the inner declaration", () => {
    const source = `float shade(float amount)
{
    float level = amount * 0.5;
    {
        float level = 1.0;
        return level;
    }
}`;
    const unused = findUnusedSlangLocals(source);

    expect(unused).toEqual([
      expect.objectContaining({ name: "level", kind: "variable", range: expect.objectContaining({ start: { line: 2, character: 10 } }) }),
    ]);
  });

  it("ignores names that only appear in comments and strings", () => {
    const source = `float4 mainImage(float2 p)
{
    float ghost = 1.0;
    // ghost is mentioned here
    /* ghost again */
    return float4("ghost", p.x, 1.0);
}`;
    const unused = findUnusedSlangLocals(source);

    expect(unused).toEqual([expect.objectContaining({ name: "ghost", kind: "variable" })]);
  });

  it("ignores commented-out declarations", () => {
    const source = `float4 mainImage(float2 p)
{
    // float phantom = 1.0;
    return float4(p, 0.0, 1.0);
}`;

    expect(findUnusedSlangLocals(source)).toEqual([]);
  });

  it("ignores struct fields and file-scope globals", () => {
    const source = `struct Material { float3 albedo; float roughness; };
static float cacheSeed = 2.0;
cbuffer Tuning { float exposure; };
float4 mainImage(float2 p)
{
    Material m;
    m.albedo = p.x;
    return float4(m.albedo, 0.0, 1.0);
}`;
    const unused = findUnusedSlangLocals(source);

    expect(unused.map((item) => item.name)).not.toContain("albedo");
    expect(unused.map((item) => item.name)).not.toContain("roughness");
    expect(unused.map((item) => item.name)).not.toContain("cacheSeed");
    expect(unused.map((item) => item.name)).not.toContain("exposure");
  });

  it("tracks for-loop variables", () => {
    const source = `float loopy(float t)
{
    float total = 0.0;
    for (int i = 0; i < 4; i++)
    {
        total += t;
    }
    return total;
}`;

    expect(findUnusedSlangLocals(source)).toEqual([]);
  });
});

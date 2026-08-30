import { describe, expect, it } from "vitest";
import { firstUnterminatedStatementLine, truncateFunctionBodyAt } from "../../util/StatementBreak";

const GLSL = `void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord.xy;
    vec2 p = uv * 10.0;
d
    p += vec2(
        fbm(p * 0.5),
        fbm(p * 0.6)
    ) * 9.0;
    fragColor = vec4(p, 0.0, 1.0);
}`;

describe("firstUnterminatedStatementLine", () => {
  it("finds a bare token left behind mid-function", () => {
    // The compiler blames the next line: `d` then `p += ...` reads as a
    // declaration of `p` with type `d`, so truncating there keeps the mistake.
    expect(firstUnterminatedStatementLine(GLSL)).toBe(5);
  });

  it("catches a two-character typo just the same", () => {
    expect(firstUnterminatedStatementLine(GLSL.replace("\nd\n", "\ndd\n"))).toBe(5);
  });

  it("returns null for a shader whose statements all terminate", () => {
    expect(firstUnterminatedStatementLine(GLSL.replace("\nd\n", "\n"))).toBeNull();
  });

  it("keeps multi-line statements whole", () => {
    const code = `void mainImage(out vec4 c, in vec2 f)
{
    vec2 p = vec2(
        1.0,
        2.0
    );
    c = vec4(p, 0.0, 1.0);
}`;

    expect(firstUnterminatedStatementLine(code)).toBeNull();
  });

  it("keeps control-flow headers and blocks", () => {
    const code = `void mainImage(out vec4 c, in vec2 f)
{
    float v = 0.0;
    for (int i = 0; i < 3; i++)
    {
        v += 1.0;
    }
    if (v > 1.0)
        v = 0.0;
    else
        v = 1.0;
    c = vec4(v);
}`;

    expect(firstUnterminatedStatementLine(code)).toBeNull();
  });

  it("leaves file-scope declarations alone, where the same shape is real code", () => {
    const code = `const float k = 1.0
float f(float x) { return x * k; }`;

    expect(firstUnterminatedStatementLine(code)).toBeNull();
  });

  it("ignores punctuation inside comments and strings", () => {
    const code = `void mainImage(out vec4 c, in vec2 f)
{
    // a stray ; in a comment
    float v = 1.0; /* and ( here */
    c = vec4(v);
}`;

    expect(firstUnterminatedStatementLine(code)).toBeNull();
  });

  it("finds it in a Slang entry point the same way", () => {
    const code = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(uv, 0.0);
d
    return float4(col, 1.0);
}`;

    expect(firstUnterminatedStatementLine(code)).toBe(5);
  });

  it("reports the first break when there are several", () => {
    const code = `void mainImage(out vec4 c, in vec2 f)
{
    float v = 1.0;
d
    float w = 2.0;
dd
    c = vec4(v + w);
}`;

    expect(firstUnterminatedStatementLine(code)).toBe(4);
  });
});

describe("an assignment left without a right-hand side", () => {
  const GLSL_UNFINISHED = `float getLen(vec3 p, vec4 s) {
    float test =
    return length(p - 0.5 - s.xyz) - s.w;
}`;
  const SLANG_UNFINISHED = `float getLen(float3 p, float4 s)
{
    float test =
    return length(p - 0.5 - s.xyz) - s.w;
}`;

  it("is found in GLSL, where the next line starts a statement of its own", () => {
    expect(firstUnterminatedStatementLine(GLSL_UNFINISHED)).toBe(2);
  });

  it("is found in Slang the same way", () => {
    expect(firstUnterminatedStatementLine(SLANG_UNFINISHED)).toBe(3);
  });

  it("still treats a genuine continuation as one", () => {
    const wrapped = `float f(float2 p) {
    float v = p.x +
        p.y;
    return v;
}`;

    expect(firstUnterminatedStatementLine(wrapped)).toBeNull();
  });

  it("cuts the unfinished assignment away in both languages", () => {
    for (const source of [GLSL_UNFINISHED, SLANG_UNFINISHED]) {
      const line = firstUnterminatedStatementLine(source)!;
      const cut = truncateFunctionBodyAt(source, line)!;

      expect(cut.split("\n")[line - 1].trim()).toBe("");
      expect(cut).toContain("return float(0);");
      expect(cut.split("\n")).toHaveLength(source.split("\n").length);
    }
  });
});

describe("truncateFunctionBodyAt", () => {
  const SLANG = `float3 helper(float2 p)
{
    return float3(p, 0.0);
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord;
    float sq = uv.x;
d
    float3 tun = helper(uv);
    return float4(tun, 1.0);
}

float extra(float x) { return x; }`;

  it("keeps every line in place so numbering does not shift", () => {
    const original = SLANG.split("\n");
    const truncated = truncateFunctionBodyAt(SLANG, 10)!.split("\n");

    // A cursor below the cut must still mean the line the user is looking at.
    expect(truncated).toHaveLength(original.length);
    expect(truncated[original.indexOf("float extra(float x) { return x; }")])
      .toBe("float extra(float x) { return x; }");
  });

  it("cuts the body above the break and returns a value", () => {
    const truncated = truncateFunctionBodyAt(SLANG, 10)!.split("\n");

    expect(truncated).toContain("    float sq = uv.x;");
    expect(truncated.filter((line) => line.trim() === "d")).toEqual([]);
    // Constructor syntax, not a cast: `(float4)0` is a syntax error in GLSL.
    expect(truncated).toContain("return float4(0);");
  });

  it("keeps the module scope on both sides of the cut function", () => {
    const truncated = truncateFunctionBodyAt(SLANG, 10)!;

    // Slang resolves functions defined further down, so they have to survive.
    expect(truncated).toContain("float3 helper(float2 p)");
    expect(truncated).toContain("float extra(float x) { return x; }");
  });

  it("balances the braces it cut through", () => {
    const truncated = truncateFunctionBodyAt(SLANG, 10)!;
    const opens = (truncated.match(/\{/g) ?? []).length;
    const closes = (truncated.match(/\}/g) ?? []).length;

    expect(opens).toBe(closes);
  });

  it("returns nothing for a line outside any function", () => {
    expect(truncateFunctionBodyAt(SLANG, 5)).toBeNull();
    expect(truncateFunctionBodyAt(SLANG, 1)).toBeNull();
  });

  it("uses constructor syntax GLSL also accepts", () => {
    const glsl = `vec3 helper(vec2 p)
{
    vec3 v = vec3(p, 0.0);
d
    return v;
}`;

    expect(truncateFunctionBodyAt(glsl, 4)).toContain("return vec3(0);");
  });

  it("returns void from a function that returns nothing", () => {
    const glsl = `void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord;
d
    fragColor = vec4(uv, 0.0, 1.0);
}`;

    expect(truncateFunctionBodyAt(glsl, 4)).toContain("return;");
  });
});

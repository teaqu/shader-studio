import { describe, expect, it } from "vitest";
import { firstUnterminatedStatementLine, truncateFunctionBodyAt } from "../../util/StatementBreak";

/**
 * The shapes an edit leaves behind. Each is written in both languages, since
 * the same heuristic serves both, and each states whether it is something the
 * cut can act on - a break inside a body - or something it must leave alone.
 */
function glsl(stray: string): string {
  return `float helper(vec2 q) { return q.x; }

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord.xy;
    float acc = helper(uv);
${stray}
    fragColor = vec4(acc);
}`;
}

function slang(stray: string): string {
  return `float helper(float2 q) { return q.x; }

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord;
    float acc = helper(uv);
${stray}
    return float4(acc);
}`;
}

/** 1-based line the stray sits on in both fixtures above. */
const STRAY = 7;

describe.each([
  ["a bare identifier", "    d"],
  ["a half-typed keyword", "    if"],
  ["a half-typed switch", "    switch"],
  ["an assignment with no value", "    float test ="],
  ["a trailing member access", "    float v = acc."],
  ["an unclosed call", "    float v = max(acc,"],
  ["a lone type name", "    float"],
  ["a second statement left dangling", "    float a = 1.0; b"],
  ["a switch with no block", "    switch (acc)"],
])("%s", (_name, stray) => {
  it("is found in GLSL", () => {
    expect(firstUnterminatedStatementLine(glsl(stray))).toBe(STRAY);
  });

  it("is found in Slang", () => {
    expect(firstUnterminatedStatementLine(slang(stray))).toBe(STRAY);
  });

  it("is cut away in both, leaving the line count and braces intact", () => {
    for (const source of [glsl(stray), slang(stray)]) {
      const line = firstUnterminatedStatementLine(source);
      if (line === null) {
        continue;
      }
      const cut = truncateFunctionBodyAt(source, line);
      expect(cut, `${stray} produced no cut`).not.toBeNull();
      expect(cut!.split("\n")).toHaveLength(source.split("\n").length);
      const code = cut!.split("\n").map((text) => text.replace(/\/\/.*$/, "")).join("\n");
      expect((code.match(/\{/g) ?? []).length).toBe((code.match(/\}/g) ?? []).length);
    }
  });
});

describe("shapes left to the compiler's own error line", () => {
  it("does not guess at a stray else", () => {
    // `else` legitimately follows a block or a single statement, and telling a
    // stray one from a real one needs full if/else pairing. Guessing wrong
    // would cut a working shader, so this stays with the compiler, whose
    // reported line still caps the capture.
    expect(firstUnterminatedStatementLine(glsl("    else"))).toBeNull();
    expect(firstUnterminatedStatementLine(slang("    else"))).toBeNull();
  });

  it("finds a control head left at the end of a body", () => {
    const glslSource = `void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float acc = fragCoord.x;
    fragColor = vec4(acc);
    if (acc > 1.0)
}`;
    const slangSource = `float4 mainImage(float2 fragCoord)
{
    float acc = fragCoord.x;
    if (acc > 1.0)
}`;

    expect(firstUnterminatedStatementLine(glslSource)).toBe(5);
    expect(firstUnterminatedStatementLine(slangSource)).toBe(4);
  });

  it("keeps a control head that does open something", () => {
    // A head followed by a single statement is complete; only a head with
    // nothing after it, or a switch without a block, is a break.
    expect(firstUnterminatedStatementLine(glsl("    if (acc > 1.0)\n        acc = 1.0;"))).toBeNull();
    expect(firstUnterminatedStatementLine(slang("    if (acc > 1.0)\n        acc = 1.0;"))).toBeNull();
    expect(firstUnterminatedStatementLine(glsl("    for (int i = 0; i < 3; i++)\n        acc += 1.0;"))).toBeNull();
    expect(firstUnterminatedStatementLine(glsl("    switch (int(acc))\n    {\n    default:\n        break;\n    }"))).toBeNull();
  });

  it("keeps a real else attached to its if", () => {
    const source = glsl(`    if (acc > 1.0) {
        acc = 1.0;
    } else {
        acc = 0.0;
    }`);

    expect(firstUnterminatedStatementLine(source)).toBeNull();
  });
});

describe("shapes the cut must not act on", () => {
  it("leaves a break at file scope alone, where there is no body to cut", () => {
    const source = `float k = 1.0
float helper(float x) { return x * k; }`;

    const line = firstUnterminatedStatementLine(source);
    expect(line === null || truncateFunctionBodyAt(source, line) === null).toBe(true);
  });

  it("leaves a struct body alone", () => {
    const source = `struct Params
{
    float gain;
d
};

float4 mainImage(float2 c) { return float4(0); }`;

    const line = firstUnterminatedStatementLine(source);
    expect(line === null || truncateFunctionBodyAt(source, line) === null).toBe(true);
  });

  it("keeps a genuinely wrapped expression whole", () => {
    expect(firstUnterminatedStatementLine(glsl("    float v = acc +\n        1.0;"))).toBeNull();
  });

  it("keeps a multi-line call whole", () => {
    expect(firstUnterminatedStatementLine(glsl("    float v = max(\n        acc,\n        1.0);"))).toBeNull();
  });
});

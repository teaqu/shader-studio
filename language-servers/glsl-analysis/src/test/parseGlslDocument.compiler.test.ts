// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const hasGlslangValidator = spawnSync("glslangValidator", ["--version"], {
  encoding: "utf8",
}).status === 0;

function compile(source: string): { readonly success: boolean; readonly error: string } {
  const result = spawnSync("glslangValidator", ["--stdin", "-S", "frag"], {
    encoding: "utf8",
    input: source,
  });
  return {
    success: result.status === 0,
    error: `${result.stdout}${result.stderr}`,
  };
}

function fragment(body: string): string {
  return `#version 300 es
precision highp float;
out vec4 fragColor;
${body}
`;
}

describe.runIf(hasGlslangValidator)("GLSL array shapes with glslangValidator", () => {
  it.each([
    ["signed integer", "1", true],
    ["unsigned integer", "uint(1)", true],
    ["floating-point", "1.0", false],
    ["boolean", "true", false],
    ["integer vector", "ivec2(0)", false],
  ])("%s array subscripts have the expected compiler result", (_name, index, accepted) => {
    const result = compile(fragment(`
int choose(int value) { return value; }
bool choose(bool value) { return value; }
int values[2];
void main() {
  int selected = choose(values[${index}]);
  fragColor = vec4(float(selected));
}`));

    expect(result.success, result.error).toBe(accepted);
  });

  it.each([
    ["array", "int values[2]", "values"],
    ["vector", "vec3 values", "values"],
    ["matrix", "mat3x2 values", "values"],
  ])("requires scalar integer subscripts for %s values", (_name, declaration, expression) => {
    const valid = compile(fragment(`
${declaration};
void main() {
  ${expression}[uint(1)];
  fragColor = vec4(1.0);
}`));
    const invalid = compile(fragment(`
${declaration};
void main() {
  ${expression}[true];
  fragColor = vec4(1.0);
}`));

    expect(valid.success, valid.error).toBe(true);
    expect(invalid.success).toBe(false);
    expect(invalid.error).toMatch(/scalar integer expression required/);
  });

  it.each([false, true])("distinguishes array overload extents in declaration order %s", (reversed) => {
    const definitions = [
      "int pick(int values[2]) { return 2; }",
      "int pick(int values[3]) { return 3; }",
    ];
    if (reversed) {
      definitions.reverse();
    }
    const accepted = compile(fragment(`
${definitions.join("\n")}
int two[2];
int three[3];
void main() {
  int selectedTwo = pick(two);
  int selectedThree = pick(three);
  fragColor = vec4(float(selectedTwo + selectedThree));
}`));
    const rejected = compile(fragment(`
${definitions.join("\n")}
int four[4];
void main() {
  int selected = pick(four);
  fragColor = vec4(float(selected));
}`));

    expect(accepted.success, accepted.error).toBe(true);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toMatch(/no matching overloaded function/);
  });

  it("accepts only same-shape array equality", () => {
    const accepted = compile(fragment(`
int left[2];
int right[2];
void main() {
  bool equal = left == right;
  fragColor = vec4(float(equal));
}`));
    const rejected = compile(fragment(`
int left[2];
int right[3];
void main() {
  bool equal = left == right;
  fragColor = vec4(float(equal));
}`));

    expect(accepted.success, accepted.error).toBe(true);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toMatch(/wrong operand types/);
  });

  it("rejects sampler equality even when the expression is passed to a bool overload", () => {
    const result = compile(fragment(`
bool choose(bool value) { return value; }
uniform sampler2D leftSampler;
uniform sampler2D rightSampler;
void main() {
  bool selected = choose(leftSampler == rightSampler);
  fragColor = vec4(float(selected));
}`));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/can't use with samplers|wrong operand types/);
  });

  it.each([
    ["scalar", "1 == 2"],
    ["vector", "vec2(1.0) == vec2(2.0)"],
    ["matrix", "mat2(1.0) == mat2(2.0)"],
    ["same-shape array", "leftArray == rightArray"],
  ])("accepts %s equality as a bool overload argument", (_name, expression) => {
    const result = compile(fragment(`
bool choose(bool value) { return value; }
int leftArray[2];
int rightArray[2];
void main() {
  bool selected = choose(${expression});
  fragColor = vec4(float(selected));
}`));

    expect(result.success, result.error).toBe(true);
  });

  it("rejects independently symbolic mismatched extents in calls and equality", () => {
    const rejectedCall = compile(fragment(`
const int N = 2;
const int M = 3;
int pick(int values[N]) { return 1; }
int actual[M];
void main() {
  int selected = pick(actual);
  fragColor = vec4(float(selected));
}`));
    const rejectedEquality = compile(fragment(`
const int N = 2;
const int M = 3;
int expected[N];
int actual[M];
void main() {
  bool equal = expected == actual;
  fragColor = vec4(float(equal));
}`));

    expect(rejectedCall.success).toBe(false);
    expect(rejectedCall.error).toMatch(/no matching overloaded function/);
    expect(rejectedEquality.success).toBe(false);
    expect(rejectedEquality.error).toMatch(/wrong operand types/);
  });

  it.each([
    ["decimal", "10", true],
    ["unsigned decimal", "10u", true],
    ["octal", "012", true],
    ["hexadecimal", "0xA", true],
    ["malformed octal", "08", false],
    ["unsafe integer", "9007199254740993", false],
  ])("%s array extents have the expected compiler result", (_name, extent, accepted) => {
    const result = compile(fragment(`
int values[${extent}];
void main() {
  fragColor = vec4(float(values[0]));
}`));

    expect(result.success, result.error).toBe(accepted);
  });

  it("rejects multidimensional indexing in GLSL ES 300", () => {
    const result = compile(fragment(`
int grid[2][3];
void main() {
  int selected = grid[1][2];
  fragColor = vec4(float(selected));
}`));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/arrays of arrays.*not supported/);
  });
});

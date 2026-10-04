import { describe, expect, it } from "vitest";
import { getShaderEntryPoints, getShaderSourceFunctions, tokenizeShaderSource } from "./ShaderEntryPoints";

describe("native shader source discovery", () => {
  it("discovers every WGSL stage with arbitrary annotation order and shared helpers", () => {
    const source = `// @fragment fn fake() {}
/* outer /* @vertex fn nested() {} */ comment */
struct Output { @builtin(position) position: vec4f }
fn shared() -> vec4f { return vec4f(1.0); }
@vertex fn vertexOne() -> Output { return Output(shared()); }
@workgroup_size(8, 8) @compute fn simulate() { if (true) { let a = 1; } }
@fragment fn bufferOne() -> @location(0) vec4f { return shared(); }
@fragment fn image() -> @location(0) vec4f { return shared(); }`;
    expect(getShaderEntryPoints(source, "wgsl")).toEqual([
      { name: "vertexOne", stage: "vertex" }, { name: "simulate", stage: "compute" },
      { name: "bufferOne", stage: "fragment" }, { name: "image", stage: "fragment" },
    ]);
    const functions = getShaderSourceFunctions(source, "wgsl");
    expect(functions.map(fn => fn.name)).toEqual(["shared", "vertexOne", "simulate", "bufferOne", "image"]);
    for (const fn of functions) {
      expect(source[fn.bodyStart - 1]).toBe("{");
      expect(source[fn.bodyEnd]).toBe("}");
      expect(source.slice(fn.start, fn.end)).toContain(`fn ${fn.name}`);
    }
  });

  it("recognizes Slang attributes without confusing structs, strings or initializers", () => {
    const source = `/* [shader("compute")] void fake() {} */
struct Output { float4 position : SV_Position; };
static const char* message = "[shader(\\"vertex\\")] void fake() {}";
float4 helper() { return float4(1); }
[shader("vertex")] Output vertices(uint index : SV_VertexID) { Output o; return o; }
[numthreads(64,1,1)] [shader("compute")] void update(uint3 id : SV_DispatchThreadID) {}
[shader("fragment")] float4 image() : SV_Target { return helper(); }
Thing initializer = Thing() { };
`;
    expect(getShaderEntryPoints(source, "slang")).toEqual([
      { name: "vertices", stage: "vertex" }, { name: "update", stage: "compute" },
      { name: "image", stage: "fragment" },
    ]);
    expect(getShaderSourceFunctions(source, "slang").map(fn => fn.name)).toEqual(["helper", "vertices", "update", "image"]);
  });

  it("ignores GLSL, non-stage attributes, nested declarations and unfinished functions", () => {
    expect(getShaderEntryPoints("@fragment fn image() {}", "glsl")).toEqual([]);
    expect(getShaderEntryPoints("@diagnostic(off, derivative_uniformity) fn helper() {}", "wgsl")).toEqual([]);
    expect(getShaderEntryPoints("fn helper() { @fragment fn nested() {} }", "wgsl")).toEqual([]);
    expect(getShaderEntryPoints("@fragment fn incomplete() {", "wgsl")).toEqual([]);
    expect(getShaderEntryPoints("/* unterminated @fragment fn nope() {}", "wgsl")).toEqual([]);
  });

  it("retains accurate offsets around escaped strings and nested comments", () => {
    const source = '/* nested /* ignored */ still ignored */ "escaped\\"string" @fragment fn image() {}';
    const tokens = tokenizeShaderSource(source);
    expect(tokens[0]?.kind).toBe("string");
    for (const token of tokens) {
      expect(source.slice(token.start, token.end)).toBe(token.text);
    }
  });
});

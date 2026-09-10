import { describe, expect, it } from "vitest";
import { extractWgslFunctionContext } from "../WgslFunctionContext";

const HELPER_SHADER = [
  "fn shade(p: vec2f, gain: f32) -> f32 {",
  "  var value: f32 = 0.0;",
  "  for (var i: i32 = 0; i < 8; i += 1) {",
  "    var sample: f32 = p.x * gain;",
  "    value += sample;",
  "  }",
  "  return value;",
  "}",
  "",
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  return vec4f(shade(coord, 0.5));",
  "}",
].join("\n");

describe("extractWgslFunctionContext", () => {
  it("reports the innermost function, its parameters, and enclosing loops", () => {
    const context = extractWgslFunctionContext(HELPER_SHADER, 3);

    expect(context).toMatchObject({
      functionName: "shade",
      returnType: "f32",
      isFunction: true,
      parameters: [
        { name: "p", type: "vec2f" },
        { name: "gain", type: "f32" },
      ],
      loops: [{ loopIndex: 0, lineNumber: 2, endLine: 5, loopHeader: expect.stringContaining("for") }],
    });
  });

  it("derives uv-based default parameter expressions in WGSL syntax", () => {
    const context = extractWgslFunctionContext(HELPER_SHADER, 3);

    expect(context?.parameters).toEqual([
      expect.objectContaining({
        name: "p",
        expression: "coord / iResolution.xy",
        defaultExpression: "coord / iResolution.xy",
      }),
      expect.objectContaining({ name: "gain", expression: "0.5", defaultExpression: "0.5" }),
    ]);
  });

  it("treats mainImage as the global entry rather than a function", () => {
    const context = extractWgslFunctionContext(HELPER_SHADER, 10);

    expect(context).toMatchObject({ functionName: "mainImage", isFunction: false });
  });

  it("treats compute entry points as non-functions", () => {
    const compute = [
      "@compute @workgroup_size(8, 8)",
      "fn mainCompute(@builtin(global_invocation_id) id: vec3u) {",
      "  var value: f32 = f32(id.x);",
      "}",
    ].join("\n");

    expect(extractWgslFunctionContext(compute, 2)).toMatchObject({
      functionName: "mainCompute",
      isFunction: false,
    });
  });

  it.each([
    ["same-line attributes", "@compute @workgroup_size(8) fn mainCompute() {\n  let value: f32 = 1.0;\n}"],
    ["multiline attributes", "@compute\n@workgroup_size(8)\nfn mainCompute() {\n  let value: f32 = 1.0;\n}"],
    ["reverse-order attributes and comments", "@workgroup_size(8)\n// compute entry\n@compute\nfn mainCompute() {\n  let value: f32 = 1.0;\n}"],
  ])("recognizes compute entries with %s", (_description, source) => {
    expect(extractWgslFunctionContext(source, source.indexOf("let value") > -1 ? source.slice(0, source.indexOf("let value")).split("\n").length - 1 : 0)).toMatchObject({
      functionName: "mainCompute",
      isFunction: false,
    });
  });

  it("does not mark a helper after a compute entry as a compute entry", () => {
    const source = [
      "@compute @workgroup_size(8)",
      "fn mainCompute() { }",
      "fn helper(value: f32) -> f32 {",
      "  return value;",
      "}",
    ].join("\n");

    expect(extractWgslFunctionContext(source, 3)).toMatchObject({
      functionName: "helper",
      isFunction: true,
    });
  });

  it("returns null outside any function body", () => {
    expect(extractWgslFunctionContext("var<private> g: f32 = 1.0;\n", 0)).toBeNull();
  });
});

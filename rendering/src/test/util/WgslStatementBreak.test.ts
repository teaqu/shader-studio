import { describe, expect, it } from "vitest";
import { enclosingFunctionRange, firstUnterminatedStatementLine, truncateFunctionBodyAt } from "../../util/StatementBreak";

/**
 * The same break heuristic serves WGSL, whose declarations, signatures and
 * control flow read differently from GLSL and Slang.
 */
function wgsl(stray: string): string {
  return `fn helper(q: vec2f) -> f32 { return q.x; }

fn mainImage(fragCoord: vec2f) -> vec4f
{
    let uv = fragCoord.xy;
    var acc = helper(uv);
${stray}
    return vec4f(acc);
}`;
}

/** 1-based line the stray sits on. */
const STRAY = 7;

describe.each([
  ["a bare identifier", "    d"],
  ["a half-typed keyword", "    if"],
  ["a half-typed switch", "    switch"],
  ["a let with no value", "    let test ="],
  ["a var with no value", "    var test: f32 ="],
  ["a trailing member access", "    let v = acc."],
  ["an unclosed call", "    let v = max(acc,"],
  ["a second statement left dangling", "    let a = 1.0; b"],
  ["a paren-less switch with no block", "    switch i32(acc)"],
])("WGSL %s", (_name, stray) => {
  it("is found", () => {
    expect(firstUnterminatedStatementLine(wgsl(stray))).toBe(STRAY);
  });

  it("is cut away, leaving the line count and braces intact", () => {
    const source = wgsl(stray);
    const cut = truncateFunctionBodyAt(source, STRAY);
    expect(cut, `${stray} produced no cut`).not.toBeNull();
    const lines = cut!.split("\n");
    expect(lines).toHaveLength(source.split("\n").length);
    expect(lines[STRAY - 1]!.trim()).toBe("");
    expect(lines[STRAY]!.trim()).toBe("return vec4f(0);");
    const code = lines.map((text) => text.replace(/\/\/.*$/, "")).join("\n");
    expect((code.match(/\{/g) ?? []).length).toBe((code.match(/\}/g) ?? []).length);
  });
});

describe("valid WGSL the scanner must leave alone", () => {
  it.each([
    ["paren-less if with the brace below", "    if acc > 1.0\n    {\n        acc = 1.0;\n    }"],
    ["paren-less while with the brace below", "    while acc > 1.0\n    {\n        acc -= 1.0;\n    }"],
    ["loop and continuing with braces below", "    loop\n    {\n        acc += 1.0;\n        continuing\n        {\n            break if acc > 3.0;\n        }\n    }"],
    ["a for loop with var", "    for (var i = 0; i < 3; i++) {\n        acc += f32(i);\n    }"],
    ["switch with case blocks", "    switch i32(acc) {\n        case 0, 1 { acc = 0.0; }\n        default { }\n    }"],
    ["a typed var declaration wrapped over lines", "    var total: f32 =\n        acc + 1.0;"],
    ["a const declaration", "    const k = 2.0;"],
    ["a compound assignment through a pointer", "    let p = &acc;\n    *p += 1.0;"],
    ["a phony assignment", "    _ = acc;"],
  ])("%s", (_name, body) => {
    expect(firstUnterminatedStatementLine(wgsl(body))).toBeNull();
  });

  it("leaves module-scope attributes and declarations alone", () => {
    const source = `@group(0) @binding(0)
var<storage, read> values: array<f32>;
alias Scalar = f32;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let v = values[id.x];
}`;
    expect(firstUnterminatedStatementLine(source)).toBeNull();
  });
});

describe("WGSL function ranges", () => {
  const source = `struct Params {
    gain: f32,
};

fn shade(p: Params, color: vec3f) -> vec3f {
    let scaled = color * p.gain;
    d
    return scaled;
}

@fragment
fn main() {
    let x = 1.0;
    y
}

fn mainImage(coord: vec2f) -> @location(0) vec4f {
    let c = coord;
    z
    return vec4f(c, 0.0, 1.0);
}

fn tint(color: vec4<f32>) -> vec4<f32> {
    let t = color;
    w
    return t;
}`;

  it("finds a function declared with fn and a return type", () => {
    expect(enclosingFunctionRange(source, 7)).toEqual({ start: 5, end: 9 });
  });

  it("returns the declared type from a function cut short", () => {
    expect(truncateFunctionBodyAt(source, 7)!.split("\n")[7]!.trim()).toBe("return vec3f(0);");
  });

  it("returns bare from a function with no return type", () => {
    // The break is the body's last line, so the return takes its place.
    const lines = truncateFunctionBodyAt(source, 14)!.split("\n");
    expect(lines[13]!.trim()).toBe("return;");
    expect(lines[14]!.trim()).toBe("}");
  });

  it("skips return-value attributes when naming the type", () => {
    expect(truncateFunctionBodyAt(source, 19)!.split("\n")[19]!.trim()).toBe("return vec4f(0);");
  });

  it("keeps template return types whole", () => {
    expect(truncateFunctionBodyAt(source, 25)!.split("\n")[25]!.trim()).toBe("return vec4<f32>(0);");
  });

  it("leaves a struct body alone", () => {
    expect(truncateFunctionBodyAt(`struct Params {\n    gain: f32,\nd\n};`, 3)).toBeNull();
  });
});

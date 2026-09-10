import { describe, expect, it } from "vitest";
import { WgslDebugEngine } from "../WgslDebugEngine";
import type { DebugPreviewOptions } from "@shader-studio/types";

function plan(source: string, options: Partial<DebugPreviewOptions>, mode = "preview") {
  const selectedLine = source.split("\n").findIndex(line => line.includes("value +="));
  const request = {
    workspace: { rootUri: "/main.wgsl", rootPath: "/main.wgsl", passName: "Image", contentHash: "deadbeef", files: [
      { uri: "/main.wgsl", path: "/main.wgsl", source, version: 1, moduleName: "", ownerPass: "Image" },
    ] }, sourceUri: "/main.wgsl", position: { line: selectedLine, character: source.split("\n")[selectedLine].search(/\S/) },
  };
  const engine = new WgslDebugEngine();
  const previewOptions = { normalizeMode: "off" as const, stepEdge: null, ...options };
  const analysis = engine.analyze(request);
  if (!analysis.ok) throw new Error(analysis.diagnostics[0]?.message);
  return mode === "capture" ? engine.planCapture(request, analysis.analysis.visibleValues.map(value => value.id), previewOptions)
    : engine.planPreview(request, previewOptions);
}
function shader(loop: string, parameters = "gain: f32, p: vec2f") {
  return `fn shade(${parameters}) -> f32 {
  var value: f32 = 0.0;
  ${loop}
    value += gain;
  }
  return value;
}
fn mainImage(coord: vec2f) -> vec4f { return vec4f(shade(0.1, coord)); }`;
}

describe("WGSL behavior instrumentation", () => {
  it.each(["preview", "capture"])("applies parameter overrides in %s with wrapper coordinates", mode => {
    const result = plan(shader("for (var i = 0; i < 8; i++) {"), {
      customParameters: new Map([[0, "0.75"], [1, "coord / iResolution.xy"]]),
    }, mode);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    const source = result.plan.files[0].source;
    expect(source).toContain("let gain: f32 = 0.75;");
    expect(source).toContain("let p: vec2f = _ssdbg_deadbeef_coord / iResolution.xy;");
    expect(source).toContain("_ssdbg_deadbeef_coord = coord;");
    expect(source).toContain("_ssdbg_deadbeef_originalParam0: f32");
  });
  it.each(["for (var i = 0; i < 8; i++) {", "while (value < 8.0) {", "loop {"])("caps %s using valid WGSL guards", loop => {
    const result = plan(shader(loop), { loopMaxIterations: new Map([[0, 3]]) });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source).toContain("if (_ssdbg_deadbeef_loop0 >= 3u) { break; }");
    expect(result.plan.files[0].source).toContain("_ssdbg_deadbeef_loop0 += 1u;");
    expect(result.plan.files[0].source).toContain("var _ssdbg_deadbeef_loop0: u32 = 0u;");
  });
  it.each([[0, 0], [-2, 0], [2.9, 2], [1e20, 0xffffffff]])("clamps and floors cap %s to %s", (cap, expected) => {
    const result = plan(shader("loop {"), { loopMaxIterations: new Map([[0, cap]]) });
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source).toContain(`>= ${expected}u) { break; }`);
  });
  it.each([NaN, Infinity, -Infinity])("rejects a non-finite loop cap %s", cap => {
    expect(plan(shader("loop {"), { loopMaxIterations: new Map([[0, cap]]) }))
      .toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-unsupported-syntax" }] });
  });
  it("numbers nested loops in source order and leaves continuing intact", () => {
    const source = shader("loop {").replace("    value += gain;", `    for (var i = 0; i < 4; i++) {
      value += gain;
    }
    continuing { break if value > 8.0; }`);
    const result = plan(source, { loopMaxIterations: new Map([[1, 2]]) });
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source).toContain("_ssdbg_deadbeef_loop1 >= 2u");
    expect(result.plan.files[0].source).not.toContain("_ssdbg_deadbeef_loop0");
    expect(result.plan.files[0].source).toContain("continuing { break if value > 8.0; }");
  });
  it("indexes editable parameters after excluding pointers", () => {
    const result = plan(shader("loop {", "out: ptr<function, f32>, gain: f32, p: vec2f"), { customParameters: new Map([[0, "0.75"], [99, "bad"]]) });
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source).toContain("out: ptr<function, f32>");
    expect(result.plan.files[0].source).toContain("let gain: f32 = 0.75;");
    expect(result.plan.files[0].source).not.toContain("bad");
  });
  it("leaves behavior unchanged when no overrides are supplied", () => {
    const result = plan(shader("while (value < 8.0) {"), {});
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source).not.toContain("_originalParam");
    expect(result.plan.files[0].source).not.toContain("_loop0");
  });
  it('rewrites wrapper coordinates without changing member names or comments', () => {
    const result = plan(shader('loop {'), { customParameters: new Map([[0, 'object.coord + coord.x /* coord */']]) });
    if (!result.ok) throw new Error('plan failed');
    expect(result.plan.files[0].source).toContain('object.coord + _ssdbg_deadbeef_coord.x /* coord */');
  });

  it('initializes nested counters where each dynamic loop starts, not once per pixel', () => {
    const source = shader('for (var outer = 0; outer < 3; outer++) {').replace('    value += gain;', `    for (var inner = 0; inner < 4; inner++) {
      value += gain;
    }`);
    const result = plan(source, { loopMaxIterations: new Map([[1, 2]]) });
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source).toMatch(/var _ssdbg_deadbeef_loop1: u32 = 0u;\s*for \(var inner/);
    expect(result.plan.files[0].source).not.toContain('var<private> _ssdbg_deadbeef_loop1');
  });
  it('binds overridden parameters in signature order regardless of map insertion order', () => {
    const result = plan(shader('loop {', 'gain: f32, bias: f32'), { customParameters: new Map([[1, 'gain * 2.0'], [0, '0.75']]) });
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.plan.files[0].source.indexOf('let gain:')).toBeLessThan(result.plan.files[0].source.indexOf('let bias:'));
  });

});

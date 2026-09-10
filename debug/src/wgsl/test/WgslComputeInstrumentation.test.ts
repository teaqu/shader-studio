import { describe, expect, it } from "vitest";
import type { DebugAnalysisRequest, DebugWorkspace } from "@shader-studio/types";
import { WgslDebugEngine } from "../WgslDebugEngine";

const options = { normalizeMode: "off" as const, stepEdge: null };
const entry = `@compute @workgroup_size(8, 4, 2)
fn update(@builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
  @builtin(local_invocation_index) index: u32) {
  let wave: f32 = f32(gid.x + lid.y + wid.x + index);
  writeOutput(gid.xy, vec4f(wave));
}`;
function request(source = entry, compute?: DebugWorkspace["compute"]): DebugAnalysisRequest {
  const line = source.split("\n").findIndex(line => line.includes("let wave"));
  return { workspace: { rootUri: "/compute.wgsl", rootPath: "/compute.wgsl", passName: "Compute", contentHash: "deadbeef", compute,
    files: [{ uri: "/compute.wgsl", path: "/compute.wgsl", source, version: 4, moduleName: "", ownerPass: "Compute" }],
  }, sourceUri: "/compute.wgsl", position: { line, character: source.split("\n")[line].search(/\S/) } };
}
function plan(source = entry, mode = "preview", compute?: DebugWorkspace["compute"]) {
  const engine = new WgslDebugEngine();
  const input = request(source, compute);
  const analysis = engine.analyze(input);
  if (!analysis.ok) {
    throw new Error(analysis.diagnostics[0]?.message);
  }
  return mode === "capture" ? engine.planCapture(input, analysis.analysis.visibleValues.map(value => value.id), options)
    : engine.planPreview(input, options);
}
function output(result: ReturnType<typeof plan>): string {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message);
  }
  return result.plan.files.find(file => file.path === "/compute.wgsl")!.source;
}
describe("WGSL compute instrumentation", () => {
  it.each(["preview", "capture"])("replays native compute as %s with native invocation arguments", mode => {
    const source = output(plan(entry, mode));
    expect(source).toContain("fn mainImage(coord: vec2f) -> vec4f");
    expect(source).toMatch(/fn _ssdbg_deadbeef_userMain\(\s*gid: vec3u/);
    expect(source).not.toMatch(/@(?:compute|workgroup_size|builtin)/);
    expect(source).toContain("vec3u(vec2u(coord), 0u)");
    expect(source).toContain("vec3u(8u, 4u, 2u)");
    expect(source).toContain("% vec3u(8u, 4u, 2u)");
    expect(source).toContain("/ vec3u(8u, 4u, 2u)");
    expect(source).toContain("% 4u) * 8u");
    expect(source).toContain("let _ssdbg_deadbeef_color = vec4f(0.0)");
    expect(source).toContain("fn writeOutput(coord: vec2u, color: vec4f) {}");
    expect(source).toContain("_ssdbg_deadbeef_slot1");
  });
  it("uses a single layered output stub and preserves a user-defined output helper", () => {
    const layered = entry.replace('writeOutput(gid.xy,', 'writeOutput(gid.xy, 1u,');
    expect(output(plan(layered))).toContain('fn writeOutput(coord: vec2u, layer: u32, color: vec4f) {}');
    const defined = `${entry}\nfn writeOutput(p: vec2u, c: vec4f) { let unused = c; }`;
    expect(output(plan(defined)).match(/fn writeOutput\(/g)).toHaveLength(1);
  });
  it("selects a configured entry and rejects ambiguous or missing entries", () => {
    const multiple = `${entry}\n@compute @workgroup_size(2) fn other() {}`;
    expect(plan(multiple)).toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-unsupported-syntax" }] });
    expect(output(plan(multiple, "preview", { entryPoint: "update" }))).toContain('fn _ssdbg_deadbeef_userMain');
    expect(plan(multiple, "preview", { entryPoint: "missing" })).toMatchObject({ ok: false });
  });
  it("rejects unsupported compute parameters rather than inventing zero arguments", () => {
    expect(plan(entry.replace('@builtin(global_invocation_id) gid: vec3u', 'gid: vec3u')))
      .toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-unsupported-syntax" }] });
  });
  it.each(['workgroupBarrier();', 'storageBarrier();', 'textureBarrier();', 'workgroupUniformLoad(&shared);', 'subgroupAdd(1u);', 'textureStore(output, vec2i(0), vec4f(1));', 'atomicAdd(&counts[0], 1u);'])('reports unsupported cooperative/storage operations: %s', operation => {
    expect(plan(entry.replace('  writeOutput', `  ${operation}\n  writeOutput`)))
      .toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-unsupported-syntax", message: expect.stringMatching(/replay/i) }] });
  });
  it("rejects workgroup memory and configured storage writes", () => {
    expect(plan(`var<workgroup> shared: array<f32, 8>;\n${entry}`)).toMatchObject({ ok: false });
    expect(plan(entry.replace('  writeOutput', '  values[gid.x] = wave;\n  writeOutput'), 'preview', { storageNames: ['values'] }))
      .toMatchObject({ ok: false, diagnostics: [{ code: 'wgsl-debug-unsupported-syntax' }] });
  });
  it("does not override builtin entry arguments, and can still cap entry loops", () => {
    const source = entry.replace('  let wave', '  for (var i = 0; i < 4; i++) {\n  let wave').replace('  writeOutput(gid.xy, vec4f(wave));', '  writeOutput(gid.xy, vec4f(wave));\n  }');
    const result = new WgslDebugEngine().planPreview(request(source), { ...options, customParameters: new Map([[0, 'bogus']]), loopMaxIterations: new Map([[0, 2]]) });
    const code = output(result);
    expect(code).not.toContain('bogus');
    expect(code).toContain('_loop0 >= 2u');
  });
  it("maps common-helper capture and overrides back to common in a compute workspace", () => {
    const input = request(entry.replace("f32(gid.x + lid.y + wid.x + index)", "shade(gid.x)"));
    const common = `fn shade(x: u32) -> f32 {
  let wave: f32 = f32(x);
  return wave;
}`;
    input.workspace.files.push({ uri: "/common.wgsl", path: "/common.wgsl", source: common, version: 1, moduleName: "", ownerPass: "Compute" });
    input.sourceUri = "/common.wgsl";
    input.position = { line: 1, character: 2 };
    const result = new WgslDebugEngine().planPreview(input, { ...options, customParameters: new Map([[0, '7u']]) });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.selectedSourceUri).toBe('/common.wgsl');
    const helper = result.plan.files.find(file => file.path === '/common.wgsl')!.source;
    expect(helper).toContain('x: u32 = 7u;');
    expect(helper).toContain('_slot1 = wave;');
    const root = result.plan.files.find(file => file.path === '/compute.wgsl')!.source;
    expect(root).toContain('fn mainImage');
    expect(root).not.toContain('fn shade');
  });
  it.each(['values[gid.x + 1u] += wave;', 'values[gid.x]++;', 'values[gid.x].items[1] = wave;', 'values[gid.x] |= 1u;', 'let pointer = &values[gid.x];'])('rejects persistent storage mutations and escaping pointers: %s', operation => {
    expect(plan(entry.replace('  writeOutput', `  ${operation}\n  writeOutput`), 'preview', { storageNames: ['values'] }))
      .toMatchObject({ ok: false, diagnostics: [{ message: expect.stringMatching(/replay/i) }] });
  });
  it("permits read-only configured storage access", () => {
    expect(output(plan(entry.replace('f32(gid.x + lid.y + wid.x + index)', 'values[gid.x + 1u]'), 'preview', { storageNames: ['values'] }))).toContain('values[gid.x + 1u]');
  });
  it("supports generic builtin vector types, comments and trailing parameter commas", () => {
    const source = entry.replace('gid: vec3u', 'gid: vec3<u32>').replace('index: u32)', 'index: u32, /* trailing */)');
    expect(output(plan(source))).toContain('gid: vec3<u32>');
  });
  it("replays a zero-parameter compute entry without adding an unused output helper", () => {
    const source = '@workgroup_size(1) @compute fn update() {\n  let wave: f32 = 0.5;\n}';
    const code = output(plan(source));
    expect(code).toContain('_ssdbg_deadbeef_userMain();');
    expect(code).not.toContain('fn writeOutput');
  });
  it("rejects unknown builtin names without throwing", () => {
    expect(plan(entry.replace('global_invocation_id', 'constructor'))).toMatchObject({ ok: false });
  });
  it("requires a native compute entry when workspace metadata identifies a compute pass", () => {
    const render = 'fn mainImage(coord: vec2f) -> vec4f {\n let wave: f32 = 0.5;\n return vec4f(wave);\n}';
    expect(plan(render, 'preview', { entryPoint: 'missing' })).toMatchObject({ ok: false });
    expect(output(plan(`${render}\n@compute @workgroup_size(1) fn unused() {}`))).toContain('let _ssdbg_deadbeef_color = _ssdbg_deadbeef_userMain(coord);');
  });
  it("provides a deterministic dispatch index in compute replay", () => {
    expect(output(plan(entry.replace('f32(gid.x + lid.y + wid.x + index)', 'f32(iDispatch)')))).toContain('var<private> iDispatch: i32 = 0;');
  });

  it("infers locals directly from the compute-only iDispatch global", () => {
    const source = entry
      .replace('  let wave: f32 = f32(gid.x + lid.y + wid.x + index);', '  let dispatch = iDispatch;')
      .replace('vec4f(wave)', 'vec4f(f32(dispatch))');
    const input = request(source.replace('let dispatch', 'let wave'), {});
    input.workspace.files[0] = { ...input.workspace.files[0], source };
    input.position = { line: source.split("\n").findIndex((line) => line.includes("let dispatch")), character: 2 };
    const result = new WgslDebugEngine().analyze(input);
    expect(result).toMatchObject({ ok: true, analysis: { visibleValues: expect.arrayContaining([
      expect.objectContaining({ name: 'dispatch', typeName: 'i32' }),
    ]) } });
  });
});

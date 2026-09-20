import { describe, expect, it } from "vitest";
import { analyzeWgslSite } from "../WgslDebugAnalyzer";
import { planWgslInstrumentation } from "../WgslInstrumentationPlanner";

const URI = "file:///work/main.wgsl";

const SOURCE = [
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  var value: f32 = coord.x;",
  "  var tint: vec3f = vec3f(value);",
  "  tint = tint + value;",
  "  return vec4f(tint, 1.0);",
  "}",
].join("\n");

function planAt(line: number, valueNames: string[], mode: "preview" | "capture" = "preview") {
  const analysis = analyzeWgslSite(SOURCE, URI, { line, character: 8 });
  if (!analysis.ok) {
    throw new Error(analysis.diagnostics[0]?.message);
  }
  const values = analysis.analysis.visibleValues.filter((value) => valueNames.includes(value.name));
  const result = planWgslInstrumentation(SOURCE, URI, "deadbeef", analysis.analysis, values.map((value) => value.id), mode);
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message);
  }
  return { plan: result.plan, analysis: analysis.analysis };
}

describe("planWgslInstrumentation", () => {
  it("instruments a declaration site with _ss_-prefixed statics and a preview wrapper", () => {
    const { plan } = planAt(1, ["value"]);
    const file = plan.files.find((item) => item.uri === URI);

    expect(plan.captureSlots).toMatchObject([
      { index: 0, typeName: "bool", hidden: true },
      { index: 1, name: "value", typeName: "f32", hidden: false },
    ]);
    expect(file?.source).toContain("var<private> _ssdbg_deadbeef_executed: bool;");
    expect(file?.source).toContain("var<private> _ssdbg_deadbeef_slot1: f32;");
    expect(file?.source).toContain("_ssdbg_deadbeef_executed = true;");
    expect(file?.source).toContain("_ssdbg_deadbeef_slot1 = value;");
    expect(file?.source).toContain("fn _ssdbg_deadbeef_userMain(coord: vec2f) -> vec4f {");
    expect(file?.source).toContain("if (_ssdbg_deadbeef_executed) { return");
    // WGSL declarations need `let`: a bare `vec4f name = ...` is Slang syntax.
    expect(file?.source).toContain("let _ssdbg_deadbeef_color = _ssdbg_deadbeef_userMain(coord);");
    expect(file?.source).not.toContain("vec4f _ssdbg_deadbeef_color =");
  });

  it("captures before return statements", () => {
    const { plan } = planAt(4, ["tint"], "capture");
    const file = plan.files.find((item) => item.uri === URI)!;

    const captureIndex = file.source.indexOf("_ssdbg_deadbeef_slot1 = tint;");
    const returnIndex = file.source.indexOf("return vec4f(tint, 1.0);");
    expect(captureIndex).toBeGreaterThan(-1);
    expect(returnIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(returnIndex);
    expect(file.source).toContain("_ss_dbgCapU.varIndex == 1");
  });

  it("emits a capture wrapper that selects slots through the capture uniform", () => {
    const { plan } = planAt(2, ["tint", "value"], "capture");
    const file = plan.files.find((item) => item.uri === URI)!;

    expect(file.source).toContain("if (_ss_dbgCapU.varIndex == 0)");
    expect(file.source).toContain("if (_ss_dbgCapU.varIndex == 2)");
    expect(file.source).toContain("let _ssdbg_deadbeef_color = _ssdbg_deadbeef_userMain(coord);");
    expect(file.source).not.toContain("vec4f _ssdbg_deadbeef_color =");
    expect(plan.executionMarkerSlot).toBe(0);
  });

  it("rejects instrumentation that would collide with its own prefix", () => {
    const clashing = `${SOURCE}\nvar<private> _ssdbg_deadbeef_slot1: f32;`;
    const analysis = analyzeWgslSite(clashing, URI, { line: 1, character: 8 });
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0]?.message);
    }
    const values = analysis.analysis.visibleValues.filter((value) => value.name === "value");

    expect(planWgslInstrumentation(clashing, URI, "deadbeef", analysis.analysis, values.map((value) => value.id), "preview"))
      .toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-instrumentation-conflict" }] });
  });

  it("rejects stale value requests", () => {
    const analysis = analyzeWgslSite(SOURCE, URI, { line: 1, character: 8 });
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0]?.message);
    }

    expect(planWgslInstrumentation(SOURCE, URI, "deadbeef", analysis.analysis, ["wgsl:nope"], "preview"))
      .toMatchObject({ ok: false, diagnostics: [{ code: "wgsl-debug-stale-request" }] });
  });

  it("replays compute entries", () => {
    const compute = "@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3u) {\n  var x: f32 = 1.0;\n}";
    const analysis = analyzeWgslSite(compute, URI, { line: 2, character: 8 });
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0]?.message);
    }
    const values = analysis.analysis.visibleValues.filter((value) => value.name === "x");

    expect(planWgslInstrumentation(compute, URI, "deadbeef", analysis.analysis, values.map((value) => value.id), "preview"))
      .toMatchObject({ ok: true });
  });
});

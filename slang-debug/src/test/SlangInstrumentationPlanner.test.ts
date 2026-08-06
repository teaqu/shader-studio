import { describe, expect, it } from "vitest";
import { analyzeSlangSite } from "../SlangDebugAnalyzer";
import { planSlangInstrumentation } from "../SlangInstrumentationPlanner";
import { createSlangWorkspace } from "../SlangWorkspace";

describe("planSlangInstrumentation", () => {
  it("edits a root Slang mainImage in place with an execution marker and capture slot", () => {
    const created = createSlangWorkspace({
      rootUri: "/work/main.slang",
      rootPath: "/work/main.slang",
      passName: "Image",
      contentHash: "a1b2c3d4ffff",
      files: [{
        uri: "/work/main.slang", path: "/work/main.slang", version: 1, moduleName: "", ownerPass: "Image",
        source: "float4 mainImage(float2 fragCoord) {\n  float value = fragCoord.x;\n  return float4(value);\n}\n",
      }],
    });
    if (!created.ok) throw new Error(created.diagnostics[0].message);
    const file = created.workspace.filesByUri.get(created.workspace.rootUri)!;
    const analysis = analyzeSlangSite(file, { line: 1, character: 8 });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);

    const result = planSlangInstrumentation(created.workspace, file, analysis.analysis, [analysis.analysis.previewValueId!], "preview");

    expect(result).toMatchObject({
      ok: true,
      plan: {
        executionMarkerSlot: 0,
        captureSlots: [
          { index: 0, name: "_ssdbg_a1b2c3d4_executed", hidden: true, typeName: "bool" },
          { index: 1, name: "value", hidden: false, typeName: "float" },
        ],
      },
    });
    if (!result.ok) return;
    const output = result.plan.files[0].source;
    expect(output).toContain("static bool _ssdbg_a1b2c3d4_executed;");
    expect(output).toContain("static float _ssdbg_a1b2c3d4_slot1;");
    expect(output).toContain("float4 _ssdbg_a1b2c3d4_userMain(float2 fragCoord)");
    expect(output).toContain("_ssdbg_a1b2c3d4_executed = true;");
    expect(output).toContain("_ssdbg_a1b2c3d4_slot1 = value;");
    expect(output).toContain("return _ssdbg_a1b2c3d4_executed ? float4(_ssdbg_a1b2c3d4_slot1");
  });

  it("rejects value identities from a stale workspace analysis", () => {
    const created = createSlangWorkspace({
      rootUri: "/work/main.slang",
      rootPath: "/work/main.slang",
      passName: "Image",
      contentHash: "new-workspace-hash",
      files: [{
        uri: "/work/main.slang", path: "/work/main.slang", version: 2, moduleName: "", ownerPass: "Image",
        source: "float4 mainImage(float2 fragCoord) {\n  float current = fragCoord.x;\n  return float4(current);\n}\n",
      }],
    });
    if (!created.ok) throw new Error(created.diagnostics[0].message);
    const file = created.workspace.filesByUri.get(created.workspace.rootUri)!;
    const analysis = analyzeSlangSite(file, { line: 1, character: 8 });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);

    const result = planSlangInstrumentation(created.workspace, file, analysis.analysis, ["value-from-version-1"], "capture");

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "slang-debug-stale-request", message: expect.stringContaining("no longer visible") }],
    });
  });

  it("writes capture values before a return statement in the default Slang shader shape", () => {
    const source = [
      "float4 mainImage(float2 fragCoord)",
      "{",
      "  float2 uv = fragCoord / iResolution.xy;",
      "  float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));",
      "  return float4(col, 1.0);",
      "}",
      "",
    ].join("\n");
    const created = createSlangWorkspace({
      rootUri: "/work/default.slang",
      rootPath: "/work/default.slang",
      passName: "Image",
      contentHash: "default1234",
      files: [{ uri: "/work/default.slang", path: "/work/default.slang", source, version: 1, moduleName: "", ownerPass: "Image" }],
    });
    if (!created.ok) throw new Error(created.diagnostics[0].message);
    const file = created.workspace.filesByUri.get(created.workspace.rootUri)!;
    const analysis = analyzeSlangSite(file, { line: 4, character: 10 });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);

    const col = analysis.analysis.visibleValues.find((value) => value.name === "col");
    if (!col) throw new Error("Expected col to be visible at the return statement");
    const result = planSlangInstrumentation(created.workspace, file, analysis.analysis, [col.id], "capture");

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const output = result.plan.files[0].source;
    expect(output.indexOf("_ssdbg_defa1234_executed = true;")).toBeLessThan(output.indexOf("return float4(col, 1.0);"));
  });

  it("declines legacy compute variable inspection without modifying the shader", () => {
    const source = [
      "void computeMain(uint3 id)",
      "{",
      "  float value = float(id.x);",
      "}",
      "",
    ].join("\n");
    const created = createSlangWorkspace({
      rootUri: "/work/compute.slang",
      rootPath: "/work/compute.slang",
      passName: "ComputeValues",
      contentHash: "compute1234",
      files: [{ uri: "/work/compute.slang", path: "/work/compute.slang", source, version: 1, moduleName: "", ownerPass: "ComputeValues" }],
    });
    if (!created.ok) throw new Error(created.diagnostics[0].message);
    const file = created.workspace.filesByUri.get(created.workspace.rootUri)!;
    const analysis = analyzeSlangSite(file, { line: 2, character: 8 });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);

    const result = planSlangInstrumentation(created.workspace, file, analysis.analysis, [analysis.analysis.previewValueId!], "preview");

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ message: "Compute variable inspection is not available yet. Your shader will continue running normally." }],
    });
  });

  it("declines native output-writing compute variable inspection", () => {
    const source = [
      '[shader("compute")]',
      '[numthreads(8, 8, 1)]',
      'void update(uint3 tid : SV_DispatchThreadID)',
      '{',
      '  float value = float(tid.x);',
      '  writeOutput(tid.xy, float4(value));',
      '}',
      '',
    ].join("\n");
    const created = createSlangWorkspace({
      rootUri: "/work/compute-output.slang",
      rootPath: "/work/compute-output.slang",
      passName: "ComputeOutput",
      contentHash: "compute5678",
      files: [{ uri: "/work/compute-output.slang", path: "/work/compute-output.slang", source, version: 1, moduleName: "", ownerPass: "ComputeOutput" }],
    });
    if (!created.ok) throw new Error(created.diagnostics[0].message);
    const file = created.workspace.filesByUri.get(created.workspace.rootUri)!;
    const analysis = analyzeSlangSite(file, { line: 4, character: 8 });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);

    const result = planSlangInstrumentation(created.workspace, file, analysis.analysis, [analysis.analysis.previewValueId!], "preview");
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ message: "Compute variable inspection is not available yet. Your shader will continue running normally." }],
    });
  });
});

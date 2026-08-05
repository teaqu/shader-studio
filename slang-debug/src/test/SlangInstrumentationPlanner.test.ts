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
});

import { describe, expect, it } from "vitest";
import type { DebugSourcePosition } from "@shader-studio/types";
import { analyzeSlangSite } from "../SlangDebugAnalyzer";
import { createSlangWorkspace } from "../SlangWorkspace";

const source = "float4 main(float2 uv) {\n"
  + "  float value = uv.x;\n"
  + "  half unsupported = half(0);\n"
  + "  if (value > 0.0) {\n"
  + "    float value = 2.0;\n"
  + "    value = value + 1.0;\n"
  + "  }\n"
  + "  return value;\n"
  + "}\n";

function analyze(position: DebugSourcePosition) {
  const created = createSlangWorkspace({
    rootUri: "/work/main.slang",
    rootPath: "/work/main.slang",
    passName: "Image",
    contentHash: "hash",
    files: [{ uri: "/work/main.slang", path: "/work/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" }],
  });
  if (!created.ok) throw new Error(created.diagnostics[0].message);
  return analyzeSlangSite(created.workspace.filesByUri.get(created.workspace.rootUri)!, position);
}

describe("analyzeSlangSite", () => {
  it("uses lexical shadowing, capture-type bounds, and enclosing control flow for an assignment preview", () => {
    const result = analyze({ line: 5, character: 8 });

    expect(result).toMatchObject({
      ok: true,
      analysis: {
        previewValueId: "declaration:file:///work/main.slang:4:10",
        visibleValues: [
          { name: "uv", typeName: "float2" },
          { name: "value", typeName: "float" },
        ],
        controlFlow: [{ kind: "if" }],
      },
    });
  });

  it("selects a direct declaration as preview and rejects an unsupported declared type", () => {
    const supported = analyze({ line: 1, character: 8 });
    const unsupported = analyze({ line: 2, character: 10 });

    expect(supported).toMatchObject({
      ok: true,
      analysis: { previewValueId: "declaration:file:///work/main.slang:1:8" },
    });
    expect(unsupported).toMatchObject({
      ok: false,
      diagnostics: [{ code: "slang-debug-non-capturable-type" }],
    });
  });

  it("does not infer a standalone expression with no explicit capture target", () => {
    const result = analyze({ line: 5, character: 14 });

    expect(result).toMatchObject({
      ok: true,
      analysis: { previewValueId: "declaration:file:///work/main.slang:4:10" },
    });
  });
});

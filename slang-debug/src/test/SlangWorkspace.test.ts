import { describe, expect, it } from "vitest";
import type { DebugWorkspace } from "@shader-studio/types";
import { createSlangWorkspace } from "../SlangWorkspace";

const source = "module Demo;\nfloat value = 1.0;\n";

function workspace(files: DebugWorkspace["files"], rootUri = files[0]?.uri ?? ""): DebugWorkspace {
  return {
    rootUri,
    rootPath: files[0]?.path ?? "",
    passName: "Image",
    files,
    contentHash: "workspace-hash",
  };
}

describe("createSlangWorkspace", () => {
  it("canonicalizes file, Windows, and virtual paths while parsing each source once", () => {
    const input = workspace([
      { uri: "/work/main.slang", path: "/work/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" },
      { uri: "C:\\work\\shared.slang", path: "C:\\work\\shared.slang", source: "float shared;", version: 2, moduleName: "Shared", ownerPass: "Image" },
      { uri: "modules/helpers.slang", path: "modules/helpers.slang", source: "float helper;", version: 3, moduleName: "Helpers", ownerPass: "Image" },
    ]);

    const result = createSlangWorkspace(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.rootUri).toBe("file:///work/main.slang");
    expect([...result.workspace.filesByUri.keys()]).toEqual([
      "file:///work/main.slang",
      "file:///C:/work/shared.slang",
      "shader-studio:///modules/helpers.slang",
    ]);
    expect(result.workspace.filesByUri.get("file:///work/main.slang")?.structure.moduleName).toBe("Demo");
    expect(result.workspace.moduleUris.get("Helpers")).toBe("shader-studio:///modules/helpers.slang");
    expect(input.files[0].uri).toBe("/work/main.slang");
  });

  it("rejects a root that is not present and duplicate canonical file identities", () => {
    const absentRoot = createSlangWorkspace(workspace([
      { uri: "/work/main.slang", path: "/work/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" },
    ], "/work/missing.slang"));
    const duplicate = createSlangWorkspace(workspace([
      { uri: "/work/main.slang", path: "/work/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" },
      { uri: "file:///work/main.slang", path: "/work/other.slang", source, version: 1, moduleName: "", ownerPass: "Image" },
    ]));

    expect(absentRoot).toMatchObject({ ok: false, diagnostics: [{ code: "debug-invalid-workspace" }] });
    expect(duplicate).toMatchObject({ ok: false, diagnostics: [{ code: "debug-invalid-workspace" }] });
  });

  it.each([-1, 1.5, Number.NaN])("rejects an invalid source version (%s)", (version) => {
    const result = createSlangWorkspace(workspace([
      { uri: "/work/main.slang", path: "/work/main.slang", source, version, moduleName: "", ownerPass: "Image" },
    ]));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "debug-invalid-workspace", message: expect.stringContaining("invalid version") }],
    });
  });
});

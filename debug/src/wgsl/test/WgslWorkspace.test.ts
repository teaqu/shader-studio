import { describe, expect, it } from "vitest";
import type { DebugWorkspace } from "@shader-studio/types";
import { canonicalizeWgslUri, createWgslWorkspace } from "../WgslWorkspace";

const source = "fn mainImage(coord: vec2f) -> vec4f {\n  return vec4f(0.0);\n}\n";

function workspace(files: DebugWorkspace["files"], rootUri = files[0]?.uri ?? ""): DebugWorkspace {
  return {
    rootUri,
    rootPath: files[0]?.path ?? "",
    passName: "Image",
    files,
    contentHash: "workspace-hash",
  };
}

describe("createWgslWorkspace", () => {
  it("canonicalizes file, Windows, and virtual paths without parsing", () => {
    const input = workspace([
      { uri: "/work/main.wgsl", path: "/work/main.wgsl", source, version: 1, moduleName: "", ownerPass: "Image" },
      { uri: "C:\\work\\shared.wgsl", path: "C:\\work\\shared.wgsl", source: "fn helper() {}", version: 2, moduleName: "", ownerPass: "Image" },
      { uri: "shaders/extra.wgsl", path: "shaders/extra.wgsl", source: "fn extra() {}", version: 3, moduleName: "", ownerPass: "Image" },
    ]);

    const result = createWgslWorkspace(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.rootUri).toBe("file:///work/main.wgsl");
    expect([...result.workspace.filesByUri.keys()]).toEqual([
      "file:///work/main.wgsl",
      "file:///C:/work/shared.wgsl",
      "shader-studio:///shaders/extra.wgsl",
    ]);
    expect(input.files[0].uri).toBe("/work/main.wgsl");
  });

  it("rejects a root that is not present and duplicate canonical file identities", () => {
    const absentRoot = createWgslWorkspace(workspace([
      { uri: "/work/main.wgsl", path: "/work/main.wgsl", source, version: 1, moduleName: "", ownerPass: "Image" },
    ], "/work/missing.wgsl"));
    const duplicate = createWgslWorkspace(workspace([
      { uri: "/work/main.wgsl", path: "/work/main.wgsl", source, version: 1, moduleName: "", ownerPass: "Image" },
      { uri: "file:///work/main.wgsl", path: "/work/other.wgsl", source, version: 1, moduleName: "", ownerPass: "Image" },
    ]));

    expect(absentRoot).toMatchObject({ ok: false, diagnostics: [{ code: "debug-invalid-workspace" }] });
    expect(duplicate).toMatchObject({ ok: false, diagnostics: [{ code: "debug-invalid-workspace" }] });
  });

  it.each([-1, 1.5, Number.NaN])("rejects an invalid source version (%s)", (version) => {
    const result = createWgslWorkspace(workspace([
      { uri: "/work/main.wgsl", path: "/work/main.wgsl", source, version, moduleName: "", ownerPass: "Image" },
    ]));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "debug-invalid-workspace", message: expect.stringContaining("invalid version") }],
    });
  });

  it("canonicalizes shader-studio and file-scheme uris identically", () => {
    expect(canonicalizeWgslUri("shader-studio:///work/main.wgsl")).toBe("shader-studio:///work/main.wgsl");
    expect(canonicalizeWgslUri("file:///work/main.wgsl")).toBe("file:///work/main.wgsl");
    expect(canonicalizeWgslUri("/work/main.wgsl")).toBe("file:///work/main.wgsl");
  });
});

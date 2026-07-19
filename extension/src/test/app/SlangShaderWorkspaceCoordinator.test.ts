import * as assert from "assert";
import * as vscode from "vscode";

import {
  SlangShaderWorkspaceCoordinator,
  type SlangShaderWorkspaceHost,
} from "../../app/SlangShaderWorkspaceCoordinator";

suite("SlangShaderWorkspaceCoordinator", () => {
  const rootUri = vscode.Uri.file("/workspace/project").toString();
  const uri = (relative: string) => vscode.Uri.file(`/workspace/project/${relative}`).toString();

  function host(
    disk: Record<string, string>,
    openDocuments: SlangShaderWorkspaceHost["openDocuments"] = [],
  ): SlangShaderWorkspaceHost {
    return {
      workspaceRoot: () => rootUri,
      findSlangFiles: async () => Object.keys(disk),
      readFile: async (fileUri) => disk[fileUri],
      openDocuments,
    };
  }

  test("routes a transitive include edit to its root without treating the helper as a root", async () => {
    const files = {
      [uri("image.slang")]: '#include "lib/lighting.slang"\nfloat4 mainImage(float2 uv) { return light(uv); }',
      [uri("lib/lighting.slang")]: '#include "palette.slang"\nfloat4 light(float2 uv) { return color(); }',
      [uri("lib/palette.slang")]: "float4 color() { return 1; }",
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files));
    await coordinator.registerRoot("/workspace/project/image.slang", []);

    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/lib/palette.slang", "float4 color() { return 0; }"),
      ["/workspace/project/image.slang"],
    );
  });

  test("returns all owning roots in deterministic order for a shared module", async () => {
    const files = {
      [uri("z.slang")]: "import shared;\nfloat4 mainImage(float2 uv) { return sharedColor(); }",
      [uri("a.slang")]: "import shared;\nfloat4 mainImage(float2 uv) { return sharedColor(); }",
      [uri("shared.slang")]: "module shared; float4 sharedColor() { return 1; }",
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files));
    await coordinator.registerRoot("/workspace/project/z.slang", []);
    await coordinator.registerRoot("/workspace/project/a.slang", []);

    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/shared.slang", files[uri("shared.slang")]),
      ["/workspace/project/a.slang", "/workspace/project/z.slang"],
    );
  });

  test("routes dependencies of configured pass files and terminates on cycles", async () => {
    const files = {
      [uri("image.slang")]: "float4 mainImage(float2 uv) { return 1; }",
      [uri("passes/a.slang")]: '#include "b.slang"\nfloat4 mainImage(float2 uv) { return b(); }',
      [uri("passes/b.slang")]: '#include "a.slang"\nfloat4 b() { return 1; }',
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files));
    await coordinator.registerRoot(
      "/workspace/project/image.slang",
      ["/workspace/project/passes/a.slang"],
    );

    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/passes/b.slang", files[uri("passes/b.slang")]),
      ["/workspace/project/image.slang"],
    );
  });

  test("uses open unsaved contents and versions in the deterministic snapshot", async () => {
    const files = {
      [uri("image.slang")]: "disk root",
      [uri("dep.slang")]: "disk dep",
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files, [{
      uri: uri("dep.slang"),
      source: "unsaved dep",
      version: 7,
    }]));

    const snapshot = await coordinator.registerRoot("/workspace/project/image.slang", []);

    assert.deepStrictEqual(snapshot.files.map((file) => file.path), [
      "/workspace/dep.slang",
      "/workspace/image.slang",
    ]);
    assert.deepStrictEqual(snapshot.files[0], {
      uri: uri("dep.slang"),
      path: "/workspace/dep.slang",
      source: "unsaved dep",
      version: 7,
    });
  });

  test("removes deleted dependencies and leaves ownerless helpers alone", async () => {
    const files = {
      [uri("image.slang")]: 'import palette;\n#include "dep.slang"\nfloat4 mainImage(float2 uv) { return dep(); }',
      [uri("dep.slang")]: "float4 dep() { return 1; }",
      [uri("palette.slang")]: "module palette; float4 color() { return 1; }",
      [uri("ownerless.slang")]: "float helper() { return 1; }",
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files));
    await coordinator.registerRoot("/workspace/project/image.slang", []);

    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/dep.slang"),
      ["/workspace/project/image.slang"],
    );
    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/ownerless.slang", files[uri("ownerless.slang")]),
      [],
    );
  });
});

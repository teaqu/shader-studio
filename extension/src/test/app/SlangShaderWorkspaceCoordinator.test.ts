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

  async function registerRoot(
    coordinator: SlangShaderWorkspaceCoordinator,
    rootPath: string,
    configuredFilePaths: readonly string[] = [],
    ownerId = `test:${rootPath}`,
  ) {
    const request = coordinator.beginOwnerRequest(ownerId, rootPath);
    const prepared = await coordinator.prepareRoots([{ rootPath, configuredFilePaths }]);
    assert.strictEqual(coordinator.commitOwnerRequest(request, prepared[0]), true);
    return prepared[0].snapshot;
  }

  test("routes a transitive include edit to its root without treating the helper as a root", async () => {
    const files = {
      [uri("image.slang")]: '#include "lib/lighting.slang"\nfloat4 mainImage(float2 uv) { return light(uv); }',
      [uri("lib/lighting.slang")]: '#include "palette.slang"\nfloat4 light(float2 uv) { return color(); }',
      [uri("lib/palette.slang")]: "float4 color() { return 1; }",
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files));
    await registerRoot(coordinator, "/workspace/project/image.slang");

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
    await registerRoot(coordinator, "/workspace/project/z.slang");
    await registerRoot(coordinator, "/workspace/project/a.slang");

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
    await registerRoot(
      coordinator,
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

    const snapshot = await registerRoot(coordinator, "/workspace/project/image.slang");

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
    await registerRoot(coordinator, "/workspace/project/image.slang");

    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/dep.slang"),
      ["/workspace/project/image.slang"],
    );
    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/ownerless.slang", files[uri("ownerless.slang")]),
      [],
    );
    assert.deepStrictEqual(
      coordinator.owningRoots(
        "/workspace/project/unrelated.slang",
        "module unrelated; float unrelatedValue() { return 1; }",
      ),
      [],
    );
  });

  test("releases switched and disposed root owners", async () => {
    const files = {
      [uri("a.slang")]: '#include "shared.slang"\nfloat4 mainImage(float2 uv) { return shared(); }',
      [uri("b.slang")]: '#include "shared.slang"\nfloat4 mainImage(float2 uv) { return shared(); }',
      [uri("shared.slang")]: "float4 shared() { return 1; }",
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(host(files));
    await registerRoot(coordinator, "/workspace/project/a.slang", [], "panel");
    await registerRoot(coordinator, "/workspace/project/b.slang", [], "panel");

    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/shared.slang", files[uri("shared.slang")]),
      ["/workspace/project/b.slang"],
    );

    (coordinator as any).releaseOwner("panel");
    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/shared.slang", files[uri("shared.slang")]),
      [],
    );
  });

  test("commits only the latest owner request when an older snapshot finishes last", async () => {
    let resolveFirstScan: (() => void) | undefined;
    let scanCount = 0;
    const files = {
      [uri("a.slang")]: "float4 mainImage(float2 uv) { return 1; }",
      [uri("b.slang")]: "float4 mainImage(float2 uv) { return 0; }",
    };
    const delayedHost = host(files);
    delayedHost.findSlangFiles = async () => {
      scanCount++;
      if (scanCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstScan = resolve;
        });
      }
      return Object.keys(files);
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(delayedHost);
    const requestA = (coordinator as any).beginOwnerRequest("panel:1", "/workspace/project/a.slang");
    const preparedA = (coordinator as any).prepareRoots([{
      rootPath: "/workspace/project/a.slang",
      configuredFilePaths: [],
    }]);
    const requestB = (coordinator as any).beginOwnerRequest("panel:1", "/workspace/project/b.slang");
    const preparedB = await (coordinator as any).prepareRoots([{
      rootPath: "/workspace/project/b.slang",
      configuredFilePaths: [],
    }]);

    assert.strictEqual((coordinator as any).commitOwnerRequest(requestB, preparedB[0]), true);
    resolveFirstScan?.();
    const staleA = await preparedA;
    assert.strictEqual((coordinator as any).commitOwnerRequest(requestA, staleA[0]), false);
    assert.deepStrictEqual(
      coordinator.owningRoots("/workspace/project/b.slang", files[uri("b.slang")]),
      ["/workspace/project/b.slang"],
    );
  });

  test("prepares three roots from one immutable workspace scan", async () => {
    let findCount = 0;
    let readCount = 0;
    const files = {
      [uri("a.slang")]: "float4 mainImage(float2 uv) { return 1; }",
      [uri("b.slang")]: "float4 mainImage(float2 uv) { return 1; }",
      [uri("c.slang")]: "float4 mainImage(float2 uv) { return 1; }",
    };
    const countedHost = host(files);
    countedHost.findSlangFiles = async () => {
      findCount++;
      return Object.keys(files);
    };
    countedHost.readFile = async (fileUri) => {
      readCount++;
      return files[fileUri as keyof typeof files];
    };
    const coordinator = new SlangShaderWorkspaceCoordinator(countedHost);

    const prepared = await (coordinator as any).prepareRoots(
      ["a", "b", "c"].map((name) => ({
        rootPath: `/workspace/project/${name}.slang`,
        configuredFilePaths: [],
      })),
    );

    assert.strictEqual(prepared.length, 3);
    assert.strictEqual(findCount, 1);
    assert.strictEqual(readCount, 3);
    assert.strictEqual(prepared[0].snapshot, prepared[1].snapshot);
    assert.strictEqual(prepared[1].snapshot, prepared[2].snapshot);
  });
});

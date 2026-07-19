import * as assert from "assert";

import {
  SlangWorkspaceSnapshotBuilder,
  type SlangWorkspaceSnapshotHost,
} from "../../app/SlangWorkspaceSnapshotBuilder";

function host(
  disk: Readonly<Record<string, string>>,
  discovered: readonly string[] = Object.keys(disk).filter((uri) => uri.endsWith(".slang")),
  openDocuments: SlangWorkspaceSnapshotHost["openDocuments"] = [],
): SlangWorkspaceSnapshotHost {
  return {
    findSlangFiles: async () => discovered,
    readFile: async (uri) => disk[uri],
    openDocuments,
  };
}

suite("SlangWorkspaceSnapshotBuilder", () => {
  const rootUri = "file:///workspace";

  test("gathers workspace Slang files and sorts by canonical path", async () => {
    const builder = new SlangWorkspaceSnapshotBuilder(host({
      "file:///workspace/z.slang": "z",
      "file:///workspace/lib/a.slang": "a",
    }, ["file:///workspace/z.slang", "file:///workspace/lib/a.slang"]));

    const snapshot = await builder.build({ rootUri });

    assert.deepStrictEqual(snapshot, {
      rootUri,
      files: [
        { uri: "file:///workspace/lib/a.slang", path: "/workspace/lib/a.slang", source: "a" },
        { uri: "file:///workspace/z.slang", path: "/workspace/z.slang", source: "z" },
      ],
    });
  });

  test("open document contents and versions override disk", async () => {
    const uri = "file:///workspace/image.slang";
    const builder = new SlangWorkspaceSnapshotBuilder(host(
      { [uri]: "disk" },
      [uri],
      [{ uri, source: "unsaved", version: 7 }],
    ));

    const snapshot = await builder.build({ rootUri });

    assert.deepStrictEqual(snapshot.files, [
      { uri, path: "/workspace/image.slang", source: "unsaved", version: 7 },
    ]);
  });

  test("includes configured roots, passes, common code, and referenced non-Slang files", async () => {
    const image = "file:///workspace/image.slang";
    const buffer = "file:///workspace/passes/buffer.slang";
    const common = "file:///workspace/common/common.slang";
    const include = "file:///workspace/include/constants.inc";
    const builder = new SlangWorkspaceSnapshotBuilder(host({
      [image]: 'import "passes/buffer.slang";',
      [buffer]: '#include "../include/constants.inc"',
      [common]: "float commonValue;",
      [include]: "#define VALUE 1",
    }, []));

    const snapshot = await builder.build({
      rootUri,
      rootFiles: [image],
      configuredPassFiles: [buffer],
      commonFiles: [common],
    });

    assert.deepStrictEqual(snapshot.files.map((file) => file.path), [
      "/workspace/common/common.slang",
      "/workspace/image.slang",
      "/workspace/include/constants.inc",
      "/workspace/passes/buffer.slang",
    ]);
  });

  test("deduplicates URI aliases by canonical workspace path", async () => {
    const builder = new SlangWorkspaceSnapshotBuilder(host({
      "file:///workspace/a.slang": "a",
      "file://localhost/workspace/a.slang": "a",
    }, ["file://localhost/workspace/a.slang", "file:///workspace/a.slang"]));

    const snapshot = await builder.build({ rootUri });

    assert.strictEqual(snapshot.files.length, 1);
    assert.strictEqual(snapshot.files[0]?.path, "/workspace/a.slang");
  });

  test("rejects discovered and configured files outside the root", async () => {
    const discovered = new SlangWorkspaceSnapshotBuilder(host({}, ["file:///other/a.slang"]));
    const configured = new SlangWorkspaceSnapshotBuilder(host({}));

    await assert.rejects(() => discovered.build({ rootUri }), /outside the Slang workspace root/);
    await assert.rejects(
      () => configured.build({ rootUri, configuredPassFiles: ["file:///other/a.slang"] }),
      /outside the Slang workspace root/,
    );
  });

  test("reports a missing explicitly configured file", async () => {
    const builder = new SlangWorkspaceSnapshotBuilder(host({}));

    await assert.rejects(
      () => builder.build({ rootUri, rootFiles: ["file:///workspace/missing.slang"] }),
      /Could not read required Slang workspace file/,
    );
  });

  test("propagates discovery failures", async () => {
    const builder = new SlangWorkspaceSnapshotBuilder({
      findSlangFiles: async () => {
        throw new Error("scan failed");
      },
      readFile: async () => undefined,
      openDocuments: [],
    });

    await assert.rejects(() => builder.build({ rootUri }), /scan failed/);
  });
});

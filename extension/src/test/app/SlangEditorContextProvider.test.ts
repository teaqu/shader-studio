import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  resolveSlangEditorPassContext,
  SlangEditorContextProvider,
  type SlangConfigSource,
  type SlangEditorContextHost,
} from "../../app/SlangEditorContextProvider";

suite("SlangEditorContextProvider", () => {
  const workspacePath = path.resolve("/workspace");

  function configSource(
    relativePath: string,
    config: unknown,
  ): SlangConfigSource {
    return {
      filePath: path.join(workspacePath, relativePath),
      text: JSON.stringify(config),
    };
  }

  test("resolves a root shader to the companion Image pass", () => {
    const resolved = resolveSlangEditorPassContext({
      focusedFilePath: path.join(workspacePath, "image.slang"),
      workspaceFolderPath: workspacePath,
      configs: [configSource("image.sha.json", {
        version: "1",
        passes: {
          Image: {
            inputs: {
              videoFeed: { type: "video", path: "clip.mp4" },
              sky: { type: "cubemap", path: "sky.png" },
            },
          },
        },
      })],
    });

    assert.ok(resolved);
    assert.strictEqual(resolved.passName, "Image");
    assert.strictEqual(resolved.rootShaderPath, path.join(workspacePath, "image.slang"));
    assert.deepStrictEqual(resolved.channels, [
      { slot: 0, key: "videoFeed", kind: "video" },
      { slot: 1, key: "sky", kind: "cubemap" },
    ]);
  });

  test("resolves a buffer file to its owning config and pass inputs", () => {
    const resolved = resolveSlangEditorPassContext({
      focusedFilePath: path.join(workspacePath, "passes", "feedback.slang"),
      workspaceFolderPath: workspacePath,
      configs: [configSource("main.sha.json", {
        version: "1",
        passes: {
          Image: {},
          BufferA: {
            path: "passes/feedback.slang",
            inputs: {
              history: { type: "buffer", source: "BufferA" },
            },
          },
        },
      })],
    });

    assert.ok(resolved);
    assert.strictEqual(resolved.passName, "BufferA");
    assert.strictEqual(resolved.rootShaderPath, path.join(workspacePath, "main.slang"));
    assert.deepStrictEqual(resolved.channels, [
      { slot: 0, key: "history", kind: "buffer" },
    ]);
  });

  test("unions all render-pass inputs for a focused common file", () => {
    const resolved = resolveSlangEditorPassContext({
      focusedFilePath: path.join(workspacePath, "common.slang"),
      workspaceFolderPath: workspacePath,
      configs: [configSource("main.sha.json", {
        version: "1",
        passes: {
          Image: { inputs: { imageTex: { type: "texture", path: "a.png" } } },
          BufferA: {
            path: "buffer.slang",
            inputs: { environment: { type: "cubemap", path: "sky.png" } },
          },
          common: { path: "common.slang" },
        },
      })],
    });

    assert.ok(resolved);
    assert.strictEqual(resolved.passName, "common");
    assert.deepStrictEqual(resolved.channels, [
      { slot: 0, key: "imageTex", kind: "texture" },
      { slot: 0, key: "environment", kind: "cubemap" },
    ]);
  });

  test("ignores malformed and unrelated configs", () => {
    const resolved = resolveSlangEditorPassContext({
      focusedFilePath: path.join(workspacePath, "orphan.slang"),
      workspaceFolderPath: workspacePath,
      configs: [
        { filePath: path.join(workspacePath, "broken.sha.json"), text: "{" },
        configSource("other.sha.json", { version: "1", passes: { Image: {} } }),
      ],
    });

    assert.strictEqual(resolved, undefined);
  });

  test("builds source with script uniforms returned for the owning config", async () => {
    const focusedPath = path.join(workspacePath, "image.slang");
    const config = configSource("image.sha.json", {
      version: "1",
      script: "uniforms.ts",
      passes: { Image: {} },
    });
    const host: SlangEditorContextHost = {
      findConfigSources: async () => [config],
      getWorkspaceFolderPath: () => workspacePath,
      resolveCustomUniforms: async (resolvedConfig, rootShaderPath) => {
        assert.strictEqual(resolvedConfig.script, "uniforms.ts");
        assert.strictEqual(rootShaderPath, focusedPath);
        return [{ name: "exposure", type: "float" }];
      },
    };
    const provider = new SlangEditorContextProvider(host);
    const document = {
      fileName: focusedPath,
      uri: vscode.Uri.file(focusedPath),
    } as vscode.TextDocument;

    const source = await provider.buildSource(document);

    assert.ok(source.includes("public static const float exposure"));
    assert.ok(source.includes("shaderStudioFocus_image"));
  });
});

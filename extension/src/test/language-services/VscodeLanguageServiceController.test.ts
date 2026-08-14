import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { DocumentRevision } from "@shader-studio/language-server-core";
import { isCurrentRevision } from "../../language-services/VscodeLanguageServiceController";
import { ShaderAuthoringEnvironmentProvider } from "../../language-services/ShaderAuthoringEnvironmentProvider";

suite("VS Code language-service revisions", () => {
  const uri = vscode.Uri.file("/workspace/shader.glsl");
  const document = { uri, version: 4 };
  const revision: DocumentRevision = {
    uri: uri.toString(),
    languageId: "glsl",
    version: 4,
    environmentGeneration: 7,
  };

  test("accepts only the exact document and environment revision", () => {
    assert.strictEqual(isCurrentRevision(document, 7, revision), true);
    assert.strictEqual(isCurrentRevision({ ...document, version: 5 }, 7, revision), false);
    assert.strictEqual(isCurrentRevision(document, 8, revision), false);
    assert.strictEqual(isCurrentRevision({ ...document, uri: vscode.Uri.file("/workspace/other.glsl") }, 7, revision), false);
  });

  test("opens imported Slang modules as virtual authoring files", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shader-studio-slang-ls-"));
    const rootPath = path.join(directory, "image.slang");
    const modulePath = path.join(directory, "palette.slang");
    try {
      fs.writeFileSync(rootPath, "import palette;\nfloat4 mainImage() { return float4(paletteColor(), 1); }");
      fs.writeFileSync(modulePath, "module palette;\npublic float3 paletteColor() { return float3(1, 0, 0); }");
      const document = await vscode.workspace.openTextDocument(rootPath);

      const environment = new ShaderAuthoringEnvironmentProvider().environmentFor(document);

      assert.deepStrictEqual(environment?.virtualFiles, [{
        uri: vscode.Uri.file(modulePath).toString(),
        text: "module palette;\npublic float3 paletteColor() { return float3(1, 0, 0); }",
        version: 1,
      }]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("starts the packaged Slang language service through VS Code completion", async () => {
    await vscode.extensions.getExtension("teaqu.shader-studio")?.activate();
    const document = await vscode.workspace.openTextDocument({
      language: "slang",
      content: "float4 mainImage(float2 fragCoord) { return nor; }",
    });
    await vscode.window.showTextDocument(document);

    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      document.uri,
      new vscode.Position(0, 46),
    );

    assert.ok(completions.items.some((item) => item.label === "normalize"));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});

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
});

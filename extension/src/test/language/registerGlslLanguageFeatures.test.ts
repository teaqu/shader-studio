import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as vscode from "vscode";
import {
  registerGlslLanguageFeatures,
  setGlslShaderConfig,
  GLSL_DOCUMENT_SELECTOR,
  GlslDefinitionProvider,
} from "../../language/registerGlslLanguageFeatures";

async function openGlsl(content: string): Promise<vscode.TextDocument> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "glsl-def-")), "shader.glsl");
  fs.writeFileSync(file, content);
  return vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

suite("GLSL definition provider", () => {
  const provider = new GlslDefinitionProvider();

  teardown(() => setGlslShaderConfig(null));

  test("uses exactly a file GLSL selector", () => {
    assert.deepStrictEqual(GLSL_DOCUMENT_SELECTOR, [{ language: "glsl", scheme: "file" }]);
  });

  test("resolves a function call to its definition", async () => {
    const document = await openGlsl([
      "float sdf(vec3 p) { return length(p); }",
      "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
      "  fragColor = vec4(sdf(vec3(0.0)));",
      "}",
    ].join("\n"));
    const location = await provider.provideDefinition(document, new vscode.Position(2, 20));
    assert.strictEqual(location?.range.start.line, 0);
    assert.strictEqual(location?.uri.toString(), document.uri.toString());
  });

  test("resolves a local variable to its declaration, shadowing globals", async () => {
    const document = await openGlsl([
      "float d = 1.0;",
      "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
      "  float d = 2.0;",
      "  fragColor = vec4(d);",
      "}",
    ].join("\n"));
    const location = await provider.provideDefinition(document, new vscode.Position(3, 20));
    assert.strictEqual(location?.range.start.line, 2);
  });

  test("returns undefined for injected uniforms", async () => {
    const document = await openGlsl("void mainImage(out vec4 c, in vec2 f) { c = vec4(iTime); }");
    const location = await provider.provideDefinition(document, new vscode.Position(0, 50));
    assert.strictEqual(location, undefined);
  });

  test("returns undefined for unknown identifiers and builtins", async () => {
    const document = await openGlsl("void mainImage(out vec4 c, in vec2 f) { c = vec4(mix(0.0, 1.0, 0.5)); }");
    const location = await provider.provideDefinition(document, new vscode.Position(0, 50));
    assert.strictEqual(location, undefined);
  });

  test("resolves symbols in other pass files from the shader config", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "glsl-def-"));
    const commonPath = path.join(directory, "common.glsl");
    fs.writeFileSync(commonPath, "float glowAmount(vec2 uv) { return length(uv); }\n");
    const mainPath = path.join(directory, "image.glsl");
    fs.writeFileSync(mainPath, "void mainImage(out vec4 c, in vec2 f) { c = vec4(glowAmount(f)); }\n");
    setGlslShaderConfig({ shaderPath: mainPath, bufferPathMap: { Image: mainPath, Common: commonPath } });

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(mainPath));
    const location = await provider.provideDefinition(document, new vscode.Position(0, 50));
    assert.strictEqual(location?.uri.fsPath, commonPath);
    assert.strictEqual(location?.range.start.line, 0);
  });

  test("registration is disabled by the glslLanguageFeatures setting", async () => {
    const configuration = vscode.workspace.getConfiguration("shader-studio");
    await configuration.update("glslLanguageFeatures", false, vscode.ConfigurationTarget.Global);
    try {
      const document = await openGlsl("float a() { return 0.0; }\nvoid b() { a(); }");
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider", document.uri, new vscode.Position(1, 11),
      );
      assert.deepStrictEqual(locations ?? [], []);
    } finally {
      await configuration.update("glslLanguageFeatures", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

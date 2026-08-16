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

  test("provides the configured compute output-layer count to Slang authoring", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shader-studio-compute-ls-"));
    const shaderDirectory = path.join(directory, "compute-lab", "passes");
    const shaderPath = path.join(shaderDirectory, "compute.slang");
    const configPath = path.join(directory, "compute.sha.json");
    try {
      fs.mkdirSync(shaderDirectory, { recursive: true });
      fs.writeFileSync(shaderPath, "[shader(\"compute\")]\n[numthreads(1, 1, 1)]\nvoid computeMain() {}");
      fs.writeFileSync(path.join(shaderDirectory, "decoy.sha.json"), JSON.stringify({
        version: "1.0",
        passes: { Image: {} },
      }));
      fs.writeFileSync(configPath, JSON.stringify({
        version: "1.0",
        passes: {
          Compute: {
            type: "compute",
            path: "./compute-lab/passes/compute.slang",
            entryPoint: "computeMain",
            outputLayers: 3,
          },
        },
      }));
      const document = await vscode.workspace.openTextDocument(shaderPath);

      const environment = new ShaderAuthoringEnvironmentProvider().environmentFor(document);

      assert.strictEqual(environment?.stage, "compute");
      assert.strictEqual(environment?.outputLayers, 3);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("uses Shader Studio compute docs and declarations for a nested Slang pass", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shader-studio-compute-hover-"));
    const shaderDirectory = path.join(directory, "compute-lab", "passes");
    const shaderPath = path.join(shaderDirectory, "compute.slang");
    try {
      fs.mkdirSync(shaderDirectory, { recursive: true });
      fs.writeFileSync(shaderPath, [
        "[shader(\"compute\")]",
        "[numthreads(1, 1, 1)]",
        "void computeMain(uint3 dispatchId : SV_DispatchThreadID)",
        "{",
        "    writeOutput(dispatchId.xy, float4(1.0));",
        "}",
      ].join("\n"));
      fs.writeFileSync(path.join(directory, "compute.sha.json"), JSON.stringify({
        version: "1.0",
        passes: {
          Compute: {
            type: "compute",
            path: "./compute-lab/passes/compute.slang",
            entryPoint: "computeMain",
          },
        },
      }));
      await vscode.extensions.getExtension("teaqu.shader-studio")?.activate();
      const document = await vscode.workspace.openTextDocument(shaderPath);
      await vscode.window.showTextDocument(document);

      const attributeHover = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        new vscode.Position(1, 3),
      );
      const outputHover = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        new vscode.Position(4, 10),
      );

      assert.ok(hoverText(attributeHover).includes("number of threads in each compute workgroup"));
      assert.ok(!hoverText(attributeHover).includes("Defined in core"));
      assert.ok(hoverText(outputHover).includes("current compute pass output texture"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(!vscode.languages.getDiagnostics(document.uri).some((diagnostic) => (
        diagnostic.message.includes("undefined identifier 'writeOutput'")
      )));
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("starts the packaged Slang language service through VS Code completion", async () => {
    await vscode.extensions.getExtension("teaqu.shader-studio")?.activate();
    const document = await vscode.workspace.openTextDocument({
      language: "slang",
      content: [
        "float3 n = normalize(float3(1));",
        "float3 m = nor;",
        "float x = fmod(3.0, 2.0);",
        "float4 c = sampleIChannel0(float2(0.5));",
      ].join("\n"),
    });
    await vscode.window.showTextDocument(document);

    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      document.uri,
      new vscode.Position(1, 14),
    );

    assert.ok(completions.items.some((item) => item.label === "normalize"));
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      new vscode.Position(0, 14),
    );
    assert.ok(hovers.some((hover) => hover.contents.some((content) => {
      const value = typeof content === "string" ? content : content.value;
      return value.includes("unit length");
    })));
    const fmodHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      new vscode.Position(2, 12),
    );
    assert.ok(hoverText(fmodHovers).includes("Floating-point remainder"));
    const channelHovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      document.uri,
      new vscode.Position(3, 20),
    );
    assert.ok(hoverText(channelHovers).includes("input channel 0"));
    const signature = await vscode.commands.executeCommand<vscode.SignatureHelp>(
      "vscode.executeSignatureHelpProvider",
      document.uri,
      new vscode.Position(0, 30),
    );
    assert.ok(signature.signatures.some((item) => item.label.includes("normalize")));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("provides mainImage contract hovers for renamed GLSL and Slang parameters", async function() {
    this.timeout(10_000);
    await vscode.extensions.getExtension("teaqu.shader-studio")?.activate();
    const glslSource = "void mainImage(out vec4 rendered, in vec2 pixelPosition) { rendered = vec4(pixelPosition, 0.0, 1.0); }";
    const glslDocument = await vscode.workspace.openTextDocument({ language: "glsl", content: glslSource });
    await vscode.window.showTextDocument(glslDocument);

    const glslOutput = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      glslDocument.uri,
      new vscode.Position(0, glslSource.indexOf("rendered") + 1),
    );
    const glslCoordinate = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      glslDocument.uri,
      new vscode.Position(0, glslSource.indexOf("pixelPosition") + 1),
    );
    assert.ok(hoverText(glslOutput).includes("RGBA output"), hoverText(glslOutput));
    assert.ok(hoverText(glslCoordinate).includes("lower-left"), hoverText(glslCoordinate));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    const slangSource = "float4 mainImage(float2 pixelPosition) { return float4(pixelPosition, 0.0, 1.0); }";
    const slangDocument = await vscode.workspace.openTextDocument({ language: "slang", content: slangSource });
    await vscode.window.showTextDocument(slangDocument);
    const slangCoordinate = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      slangDocument.uri,
      new vscode.Position(0, slangSource.indexOf("pixelPosition") + 1),
    );
    assert.ok(hoverText(slangCoordinate).includes("lower-left"), hoverText(slangCoordinate));
    const slangCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      slangDocument.uri,
      new vscode.Position(0, slangSource.lastIndexOf("pixelPosition") + 5),
    );
    assert.ok(completionDocumentation(slangCompletions, "mainImage").includes("fragment entry point"));
    assert.ok(completionDocumentation(slangCompletions, "pixelPosition").includes("lower-left"));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("provides vertex-hook hovers for renamed GLSL and Slang parameters", async function() {
    this.timeout(10_000);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shader-studio-vertex-hover-"));
    const glslPath = path.join(directory, "mesh.glsl");
    const slangPath = path.join(directory, "mesh.slang");
    const glslSource = "void mainVertex(inout vec3 deformed, inout vec3 surfaceNormal, inout vec2 textureUv) { deformed += surfaceNormal * textureUv.x; }";
    const slangSource = "void mainVertex(inout float3 deformed, inout float3 surfaceNormal, inout float2 textureUv) { deformed += surfaceNormal * textureUv.x; }";
    try {
      fs.writeFileSync(glslPath, glslSource);
      fs.writeFileSync(slangPath, slangSource);
      fs.writeFileSync(path.join(directory, "vertex.sha.json"), JSON.stringify({
        version: "1.0",
        passes: {
          Glsl: { path: "fragment.glsl", vertex: "mesh.glsl" },
          Slang: { path: "fragment.slang", vertex: "mesh.slang" },
        },
      }));
      await vscode.extensions.getExtension("teaqu.shader-studio")?.activate();

      const glslDocument = await vscode.workspace.openTextDocument(glslPath);
      await vscode.window.showTextDocument(glslDocument);
      const glslPosition = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        glslDocument.uri,
        new vscode.Position(0, glslSource.indexOf("deformed") + 1),
      );
      assert.ok(hoverText(glslPosition).includes("vertex position"), hoverText(glslPosition));
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

      const slangDocument = await vscode.workspace.openTextDocument(slangPath);
      await vscode.window.showTextDocument(slangDocument);
      const slangPosition = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        slangDocument.uri,
        new vscode.Position(0, slangSource.indexOf("deformed") + 1),
      );
      const slangUv = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        slangDocument.uri,
        new vscode.Position(0, slangSource.indexOf("textureUv") + 1),
      );
      assert.ok(hoverText(slangPosition).includes("vertex position"), hoverText(slangPosition));
      assert.ok(hoverText(slangUv).includes("texture coordinate"), hoverText(slangUv));
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("publishes bundled Slang compiler diagnostics in VS Code", async () => {
    await vscode.extensions.getExtension("teaqu.shader-studio")?.activate();
    const document = await vscode.workspace.openTextDocument({
      language: "slang",
      content: "float4 mainImage(float2 p) { return badName; }",
    });
    await vscode.window.showTextDocument(document);

    const diagnostic = await waitForDiagnostic(document.uri, "undefined identifier");

    assert.strictEqual(diagnostic.source, "shader-studio-slang-compiler");
    assert.deepStrictEqual(diagnostic.range.start, new vscode.Position(0, 36));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});

async function waitForDiagnostic(uri: vscode.Uri, message: string): Promise<vscode.Diagnostic> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const diagnostic = vscode.languages.getDiagnostics(uri).find((item) => item.message.includes(message));
    if (diagnostic) {
      return diagnostic;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for diagnostic containing: ${message}`);
}

function hoverText(hovers: readonly vscode.Hover[]): string {
  return hovers.flatMap((hover) => hover.contents.map((content) => (
    typeof content === "string" ? content : content.value
  ))).join("\n");
}

function completionDocumentation(completions: vscode.CompletionList, label: string): string {
  const documentation = completions.items.find((item) => item.label === label)?.documentation;
  return typeof documentation === "string" ? documentation : documentation?.value ?? "";
}

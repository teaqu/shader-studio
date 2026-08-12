import * as vscode from "vscode";
import { ShaderStudio } from "./app/ShaderStudio";
import { applySnippetContributionSetting } from "./app/SnippetContributionSetting";

import * as path from "path";
import { GlslToJsTranspiler } from "./app/Transpiler";
import { VscodeLanguageServiceController } from "./language-services/VscodeLanguageServiceController";
import { createExtensionLanguageServiceFactories } from "./language-services/createExtensionLanguageServices";


let shaderExtension: ShaderStudio | undefined;
let languageServices: VscodeLanguageServiceController | undefined;

export function activate(context: vscode.ExtensionContext) {
  const isDevMode = process.env.NODE_ENV === "dev";
  const outputChannel = vscode.window.createOutputChannel("Shader Studio", {
    log: true,
  });
  outputChannel.debug("Output channel initialized");

  const diagnosticCollection = vscode.languages.createDiagnosticCollection(
    "shader-studio",
  );
  context.subscriptions.push(diagnosticCollection);

  languageServices = new VscodeLanguageServiceController(createExtensionLanguageServiceFactories(context));
  languageServices.start(context);

  // Listen for configuration changes that require restart
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('shader-studio.enableSnippets')) {
        await updateSnippetsContribution();
        vscode.window.showInformationMessage(
          'Extension restart required to apply snippet settings.',
          'Restart Now'
        ).then(selection => {
          if (selection === 'Restart Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
      }
    })
  );

  // Register GLSL to JS transpile command
  context.subscriptions.push(
    vscode.commands.registerCommand("shader-studio.transpileGlslToJs", async (fileUri?: vscode.Uri) => {
      try {
        let uri = fileUri;
        if (!uri) {
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor) {
            vscode.window.showErrorMessage("No active editor or file selected.");
            return;
          }
          uri = activeEditor.document.uri;
        }
				   try {
					   const output = GlslToJsTranspiler.transpileFile(uri);
					   if (!output) {
            return;
          }
					   const outPath = GlslToJsTranspiler.writeTranspiledFile(uri, output);
					   vscode.window.showInformationMessage(`Transpiled GLSL to JS: ${path.basename(outPath)}`);
					   const doc = await vscode.workspace.openTextDocument(outPath);
					   vscode.window.showTextDocument(doc);
				   } catch (err) {
					   vscode.window.showErrorMessage(`GLSL Transpile failed: ${err}`);
				   }
      } catch (err) {
        vscode.window.showErrorMessage(`GLSL Transpile failed: ${err}`);
      }
    })
  );


  try {
    shaderExtension = new ShaderStudio(
      context,
      outputChannel,
      diagnosticCollection,
    );

    outputChannel.info("Shader Studio extension activated successfully");
  } catch (error) {
    outputChannel.error(`Failed to activate Shader Studio extension: ${error}`);
    vscode.window.showErrorMessage(`Shader Studio activation failed: ${error}`);
  }
}

// Update snippets contribution in package.json based on enableSnippets setting
async function updateSnippetsContribution(): Promise<void> {
  try {
    const extension = vscode.extensions.getExtension('teaqu.shader-studio');
    if (!extension) {
      return;
    }

    const extensionPath = extension.extensionPath;
    const packageJsonPath = require('path').join(extensionPath, 'package.json');
    const fs = require('fs');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    const config = vscode.workspace.getConfiguration('shader-studio');
    const enabled = config.get<boolean>('enableSnippets', true);

    applySnippetContributionSetting(packageJson, enabled);

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  } catch (error) {
    console.error(`Failed to update snippets contribution: ${error}`);
  }
}

export function deactivate() {
  languageServices?.dispose();
  languageServices = undefined;
  if (shaderExtension) {
    shaderExtension.dispose();
    shaderExtension = undefined;
  }
}

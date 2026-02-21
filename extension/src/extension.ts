import * as vscode from "vscode";
import { ShaderStudio } from "./app/ShaderStudio";

import * as path from "path";
import { GlslToJsTranspiler } from "./app/Transpiler";

let shaderExtension: ShaderStudio | undefined;

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

	// Listen for configuration changes that require restart
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (event.affectsConfiguration('shader-studio.defaultConfigView')) {
				await updateCustomEditorPriority();
				vscode.window.showInformationMessage(
					'Extension restart required to apply the new default config view preference.',
					'Restart Now'
				).then(selection => {
					if (selection === 'Restart Now') {
						vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				});
			} else if (event.affectsConfiguration('shader-studio.enableSnippets')) {
				await updateSnippetsContribution();
				vscode.window.showInformationMessage(
					'Extension restart required to apply snippet settings.',
					'Restart Now'
				).then(selection => {
					if (selection === 'Restart Now') {
						vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				});
			} else if (event.affectsConfiguration('shader-studio.webSocketPort')) {
				vscode.window.showInformationMessage(
					'Extension restart required to apply the new WebSocket port configuration.',
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
					   if (!output) return;
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

// Update custom editor priority in package.json
export async function updateCustomEditorPriority(): Promise<void> {
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
    const defaultView = config.get<string>('defaultConfigView', 'gui');
    
    const newPriority = defaultView === 'code' ? 'option' : 'default';
    packageJson.contributes.customEditors[0].priority = newPriority;
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    console.log(`Updated custom editor priority to: ${newPriority}`);
  } catch (error) {
    console.error(`Failed to update custom editor priority: ${error}`);
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

    if (enabled) {
      if (!packageJson.contributes.snippets) {
        packageJson.contributes.snippets = [
          { language: "glsl", path: "./snippets/sdf-2d.code-snippets" },
          { language: "glsl", path: "./snippets/sdf-3d.code-snippets" },
          { language: "glsl", path: "./snippets/sdf-operations.code-snippets" },
          { language: "glsl", path: "./snippets/transformations.code-snippets" },
          { language: "glsl", path: "./snippets/ray-marching.code-snippets" },
          { language: "glsl", path: "./snippets/noise.code-snippets" },
          { language: "glsl", path: "./snippets/math.code-snippets" },
          { language: "glsl", path: "./snippets/color.code-snippets" },
          { language: "glsl", path: "./snippets/coordinates.code-snippets" },
          { language: "glsl", path: "./snippets/templates.code-snippets" }
        ];
      }
    } else {
      delete packageJson.contributes.snippets;
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  } catch (error) {
    console.error(`Failed to update snippets contribution: ${error}`);
  }
}

export function deactivate() {
	if (shaderExtension) {
		shaderExtension.dispose();
		shaderExtension = undefined;
	}
}

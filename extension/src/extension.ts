import * as vscode from "vscode";
import { ShaderStudio } from "./app/ShaderStudio";

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

export function deactivate() {
	if (shaderExtension) {
		shaderExtension.dispose();
		shaderExtension = undefined;
	}
}

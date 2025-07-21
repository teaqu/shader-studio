import * as vscode from "vscode";
import { ShaderExtension } from "./app/ShaderView";

let shaderExtension: ShaderExtension | undefined;

export function activate(context: vscode.ExtensionContext) {
	const isDevMode = process.env.NODE_ENV === "dev";
	const outputChannel = vscode.window.createOutputChannel("Shader View", {
		log: true,
	});
	outputChannel.debug("Output channel initialized");

	const diagnosticCollection = vscode.languages.createDiagnosticCollection(
		"shader-view",
	);
	context.subscriptions.push(diagnosticCollection);

	try {
		shaderExtension = new ShaderExtension(
			context,
			outputChannel,
			diagnosticCollection,
		);

		if (isDevMode) {
			shaderExtension.initializeDevMode();
		}

		setTimeout(() => {
			if (shaderExtension) {
				outputChannel.info("Auto-starting web server for debugging...");
				vscode.commands.executeCommand("shader-view.startWebServer");
			}
		}, 2000);

		outputChannel.info("Shader View extension activated successfully");
	} catch (error) {
		outputChannel.error(`Failed to activate Shader View extension: ${error}`);
		vscode.window.showErrorMessage(`Shader View activation failed: ${error}`);
	}
}

export function deactivate() {
	if (shaderExtension) {
		shaderExtension.dispose();
		shaderExtension = undefined;
	}
}

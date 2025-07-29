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

export function deactivate() {
	if (shaderExtension) {
		shaderExtension.dispose();
		shaderExtension = undefined;
	}
}

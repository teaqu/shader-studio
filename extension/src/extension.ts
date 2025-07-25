import * as vscode from "vscode";
import { ShaderView } from "./app/ShaderView";

let shaderExtension: ShaderView | undefined;

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
		shaderExtension = new ShaderView(
			context,
			outputChannel,
			diagnosticCollection,
		);

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

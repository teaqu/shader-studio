import * as vscode from "vscode";
import { ShaderViewController } from "./ShaderViewController";

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

	// Initialize the main controller
	const controller = new ShaderViewController(
		context,
		outputChannel,
		diagnosticCollection,
	);

	// Auto-open panel in dev mode
	if (isDevMode) {
		controller.initializeDevMode();
	}
}

export function deactivate() {}

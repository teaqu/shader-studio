import * as vscode from "vscode";
import { Shadera } from "./app/Shadera";

let shaderExtension: Shadera | undefined;

export function activate(context: vscode.ExtensionContext) {
	const isDevMode = process.env.NODE_ENV === "dev";
	const outputChannel = vscode.window.createOutputChannel("Shadera", {
		log: true,
	});
	outputChannel.debug("Output channel initialized");

	const diagnosticCollection = vscode.languages.createDiagnosticCollection(
		"shadera",
	);
	context.subscriptions.push(diagnosticCollection);

	try {
		shaderExtension = new Shadera(
			context,
			outputChannel,
			diagnosticCollection,
		);

		outputChannel.info("Shadera extension activated successfully");
	} catch (error) {
		outputChannel.error(`Failed to activate Shadera extension: ${error}`);
		vscode.window.showErrorMessage(`Shadera activation failed: ${error}`);
	}
}

export function deactivate() {
	if (shaderExtension) {
		shaderExtension.dispose();
		shaderExtension = undefined;
	}
}

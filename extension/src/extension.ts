import * as vscode from "vscode";
import { WebviewManager } from "./webview/WebviewManager";
import { LockManager } from "./lock/LockManager";
import { ShaderProcessor } from "./shader/ShaderProcessor";

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

	const webviewManager = new WebviewManager(
		context,
		outputChannel,
		diagnosticCollection,
	);
	const shaderProcessor = new ShaderProcessor(outputChannel);

	// Create lock manager with callback to send shader
	const sendShaderCallback = (editor: vscode.TextEditor) => {
		const panel = webviewManager.getPanel();
		if (panel) {
			const finalEditor = lockManager.shouldUseLocked(editor);
			lockManager.setCurrentlyPreviewedEditor(finalEditor);
			shaderProcessor.sendShaderToWebview(
				finalEditor,
				panel,
				lockManager.getIsLocked(),
			);
		}
	};

	const lockManager = new LockManager(outputChannel, sendShaderCallback);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand("shader-view.view", () => {
			outputChannel.info("shader-view.view command executed");

			const editor = vscode.window.activeTextEditor ??
				vscode.window.visibleTextEditors.find((e) =>
					e.document.languageId === "glsl" ||
					e.document.fileName.endsWith(".glsl")
				);
			if (!editor) {
				vscode.window.showErrorMessage("No active GLSL file selected");
				return;
			}

			webviewManager.createWebviewPanel(editor);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("shader-view.toggleLock", () => {
			lockManager.toggleLock();
		}),
	);

	// Update shader when switching active editor
	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (!editor) return;

		// Check for auto-lock behavior
		if (lockManager.shouldAutoLock(editor)) {
			return; // Don't update the shader, keep showing the locked one
		}

		sendShaderCallback(editor);
	});

	// Update shader as it's edited
	vscode.workspace.onDidChangeTextDocument((event) => {
		const editor = vscode.window.activeTextEditor;

		// Only process GLSL files
		if (
			event.document.languageId !== "glsl" &&
			!event.document.fileName.endsWith(".glsl")
		) {
			return;
		}

		if (editor) {
			sendShaderCallback(editor);
		}
	});

	// Auto-open panel in dev mode
	if (isDevMode) {
		// Close all empty editor groups (usually left from webview reloads)
		const layout = vscode.window.tabGroups.all;

		for (const group of layout) {
			if (group.tabs.length === 0) {
				vscode.window.tabGroups.close(group);
			}
		}

		// Then open the panel cleanly
		vscode.commands.executeCommand("shader-view.view");
	}
}

export function deactivate() {}

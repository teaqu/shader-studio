import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
	let panel: vscode.WebviewPanel | undefined;
	const isDevMode = process.env.NODE_ENV === "dev";
	const outputChannel = vscode.window.createOutputChannel("Shader View", {
		log: true,
	});

	const sendShaderToWebview = (editor: vscode.TextEditor) => {
		if (panel && editor?.document.languageId === "glsl") {
			panel.webview.postMessage({
				type: "shaderSource",
				code: editor.document.getText(),
			});
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("shader-view.view", () => {
			if (panel) {
				panel.reveal(vscode.ViewColumn.Beside);
				sendShaderToWebview(vscode.window.activeTextEditor!);
				return;
			}

			const editor = vscode.window.activeTextEditor ??
				vscode.window.visibleTextEditors.find((e) =>
					e.document.languageId === "glsl" ||
					e.document.fileName.endsWith(".glsl")
				);
			if (!editor) {
				vscode.window.showErrorMessage("No active GLSL file selected");
				return;
			}

			panel = vscode.window.createWebviewPanel(
				"shaderToy",
				"ShaderToy",
				vscode.ViewColumn.Beside,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [
						vscode.Uri.file(
							path.join(context.extensionPath, "webview-ui", "dist"),
						),
					],
				},
			);

			panel.webview.onDidReceiveMessage(
				(message) => {
					if (message.type === "log") {
						const logText = message.payload.join
							? message.payload.join(" ")
							: message.payload;
						outputChannel.info(logText); // <-- Use info for normal logs

						// 🟢 Clear errors if shader compiled successfully
						if (
							logText.includes("Shader compiled and linked") &&
							vscode.window.activeTextEditor?.document.languageId === "glsl"
						) {
							diagnosticCollection.delete(
								vscode.window.activeTextEditor.document.uri,
							);
						}
					}

					if (message.type === "error") {
						const errorText = message.payload.join
							? message.payload.join(" ")
							: message.payload;
						outputChannel.error(errorText); // <-- Use error for errors

						// Try to extract GLSL error line (e.g., ERROR: 0:29: ...)
						const match = errorText.match(/ERROR:\s*\d+:(\d+):/);
						const editor = vscode.window.activeTextEditor;
						if (match && editor && editor.document.languageId === "glsl") {
							const lineNum = parseInt(match[1], 10) - 1; // VS Code is 0-based
							const range = editor.document.lineAt(lineNum).range;

							// Set diagnostic
							const diagnostic = new vscode.Diagnostic(
								range,
								errorText,
								vscode.DiagnosticSeverity.Error,
							);
							diagnosticCollection.set(editor.document.uri, [diagnostic]);
						} else if (editor) {
							// Clear diagnostics if no error
							diagnosticCollection.delete(editor.document.uri);
						}
					}
				},
				undefined,
				context.subscriptions,
			);

			const htmlPath = path.join(
				context.extensionPath,
				"webview-ui",
				"dist",
				"index.html",
			);
			const rawHtml = fs.readFileSync(htmlPath, "utf-8");

			panel.webview.html = rawHtml.replace(
				/(src|href)="(.+?)"/g,
				(_, attr, file) => {
					const cleaned = file.replace(/^\\|^\//, "");
					const filePath = path.join(
						context.extensionPath,
						"webview-ui",
						"dist",
						cleaned,
					);
					const uri = panel.webview.asWebviewUri(vscode.Uri.file(filePath));
					return `${attr}="${uri}"`;
				},
			);

			// Send shader on first load
			setTimeout(() => sendShaderToWebview(editor), 200);

			// Dispose handler
			panel.onDidDispose(() => {
				panel = undefined;
			});
		}),
	);

	// 🔁 Update shader code on file change
	const watcher = vscode.workspace.createFileSystemWatcher("**/*.glsl");
	watcher.onDidChange((uri) => {
		if (vscode.window.activeTextEditor?.document.uri.fsPath === uri.fsPath) {
			sendShaderToWebview(vscode.window.activeTextEditor);
		}
	});
	context.subscriptions.push(watcher);

	// 🧭 Update shader when switching active editor
	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor) sendShaderToWebview(editor);
	});

	// ⌨️ Update shader as it's edited (optional)
	vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.document === vscode.window.activeTextEditor?.document) {
			sendShaderToWebview(vscode.window.activeTextEditor);
		}
	});
	// ✅ Auto-open panel in dev mode
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

	const diagnosticCollection = vscode.languages.createDiagnosticCollection(
		"shader-view",
	);
	context.subscriptions.push(diagnosticCollection);
}

export function deactivate() {}

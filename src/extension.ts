import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
	let panel: vscode.WebviewPanel | undefined;

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

			const editor = vscode.window.activeTextEditor;
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
}

export function deactivate() {}

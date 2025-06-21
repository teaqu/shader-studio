import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parse as parseJSONC } from "jsonc-parser";

export function activate(context: vscode.ExtensionContext) {
	let panel: vscode.WebviewPanel | undefined;
	const isDevMode = process.env.NODE_ENV === "dev";
	const outputChannel = vscode.window.createOutputChannel("Shader View", {
		log: true,
	});
	outputChannel.debug("Output channel initialized");

	const sendShaderToWebview = (editor: vscode.TextEditor) => {
		outputChannel.debug("sendShaderToWebview called");
		if (panel && editor?.document.languageId === "glsl") {
			const code = editor.document.getText();
			outputChannel.debug(`Sending shader code (length: ${code.length})`);

			// Try to load config from a sibling .config.json file
			let config: any = null;
			const shaderPath = editor.document.uri.fsPath;
			const configPath = shaderPath.replace(/\.glsl$/i, ".config.json");
			if (fs.existsSync(configPath)) {
				try {
					const configRaw = fs.readFileSync(configPath, "utf-8");
					config = parseJSONC(configRaw);

					// Patch image paths for all top-level keys except "version"
					for (const passName of Object.keys(config)) {
						if (passName === "version") continue;
						const pass = config[passName];
						if (typeof pass !== "object") continue;

						// Patch pass-level "path" (for buffer source files)
						if (pass.path && typeof pass.path === "string") {
							const bufferPath = path.isAbsolute(pass.path)
								? pass.path
								: path.join(path.dirname(shaderPath), pass.path);
							if (fs.existsSync(bufferPath)) {
								const webviewUri = panel.webview.asWebviewUri(
									vscode.Uri.file(bufferPath),
								);
								pass.path = webviewUri.toString();
								outputChannel.debug(
									`Patched buffer path for ${passName}: ${pass.path}`,
								);
							} else {
								outputChannel.warn(
									`Buffer source not found for ${passName}: ${bufferPath}`,
								);
							}
						}

						// Patch iChannelN image paths inside "inputs"
						if (pass.inputs && typeof pass.inputs === "object") {
							for (const key of Object.keys(pass.inputs)) {
								const input = pass.inputs[key];
								if (input.type && input.path) {
									const imgPath = path.isAbsolute(input.path)
										? input.path
										: path.join(path.dirname(shaderPath), input.path);
									if (fs.existsSync(imgPath)) {
										const webviewUri = panel.webview.asWebviewUri(
											vscode.Uri.file(imgPath),
										);
										input.path = webviewUri.toString();
										outputChannel.debug(
											`Patched image path for ${passName}.inputs.${key}: ${input.path}`,
										);
									} else {
										outputChannel.warn(
											`Image not found for ${passName}.inputs.${key}: ${imgPath}`,
										);
									}
								}
							}
						}
					}

					outputChannel.debug(
						`Loaded config for shader: ${configPath} ${JSON.stringify(config)}`,
					);
				} catch (e) {
					vscode.window.showWarningMessage(
						`Failed to parse config: ${configPath}`,
					);
					config = null;
				}
			}

			// After preparing config
			panel.webview.postMessage({
				type: "shaderSource",
				code,
				config,
			});
			outputChannel.debug("Shader message sent to webview");
		} else {
			outputChannel.warn(
				`Panel or editor not ready: panel=${!!panel}, lang=${editor?.document.languageId}`,
			);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("shader-view.view", () => {
			outputChannel.info("shader-view.view command executed");

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

			const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) =>
				f.uri
			) ?? [];
			const shaderDir = vscode.Uri.file(
				path.dirname(editor.document.uri.fsPath),
			);

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
						shaderDir,
						...workspaceFolders,
					],
				},
			);
			outputChannel.info("Webview panel created");

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

					if (message.type === "debug") {
						const debugText = message.payload.join
							? message.payload.join(" ")
							: message.payload;
						outputChannel.debug(debugText);
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
			outputChannel.debug("Webview HTML set");

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

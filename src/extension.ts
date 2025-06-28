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

	let isLocked = false;
	let lockedEditor: vscode.TextEditor | undefined = undefined;
	let currentlyPreviewedEditor: vscode.TextEditor | undefined = undefined;

	// In your lastSent, add tracking for individual buffers
	let lastSent = {
		code: "",
		config: "",
		name: "",
		isLocked: false,
		// Removing bufferHashes
	};

	let sendTimeout: NodeJS.Timeout | null = null;

	const getEditorByPath = (
		filePath: string,
		callback?: (editor: vscode.TextEditor | undefined) => void,
	): vscode.TextEditor | undefined => {
		// Check if file exists first
		if (!fs.existsSync(filePath)) {
			outputChannel.error(`File not found: ${filePath}`);
			if (callback) callback(undefined);
			return undefined;
		}

		// Try to find among visible editors
		const editors = vscode.window.visibleTextEditors.filter(
			(editor) => editor.document.uri.fsPath === filePath,
		);
		const editor = editors.length > 0 ? editors[0] : undefined;

		if (editor) {
			outputChannel.debug(`Found open editor for file: ${filePath}`);
			if (callback) callback(editor);
			return editor;
		}

		// Try to find the document in memory before opening
		const documents = vscode.workspace.textDocuments;
		const existingDoc = documents.find((doc) => doc.fileName === filePath);

		if (existingDoc) {
			outputChannel.debug(`Found document in memory for: ${filePath}`);
		}

		outputChannel.debug(
			`Returning undefined for now, editor will open asynchronously: ${filePath}`,
		);
		return undefined;
	};

	// Create a cache for shader content
	const contentCache = new Map<
		string,
		{ timestamp: number; content: string }
	>();

	// Keep track of buffer files referenced by each shader
	const shaderBuffersMap = new Map<string, Set<string>>();

	const sendShaderToWebview = (editor: vscode.TextEditor) => {
		if (!panel || editor?.document.languageId !== "glsl") return;

		if (
			isLocked && lockedEditor &&
			editor.document.uri.fsPath !== lockedEditor.document.uri.fsPath
		) {
			editor = lockedEditor; // Use the locked editor if set
		}

		// Track the currently previewed editor
		currentlyPreviewedEditor = editor;

		const code = editor.document.getText();

		// Ignore GLSL files that do not contain mainImage
		if (!code.includes("mainImage")) {
			vscode.window.showWarningMessage(
				"GLSL file ignored: missing mainImage function.",
			);
			return;
		}

		const name = path.basename(editor.document.uri.fsPath);
		const shaderPath = editor.document.uri.fsPath;

		// Try to load config from a sibling .config.json file
		let config: any = null;
		const configPath = shaderPath.replace(/\.glsl$/i, ".config.json");

		// Collect buffer contents
		const buffers: Record<string, string> = {};
		// Removed bufferHashes

		if (fs.existsSync(configPath)) {
			try {
				// Use the latest config from disk
				const configRaw = fs.readFileSync(configPath, "utf-8");
				config = parseJSONC(configRaw);

				// Process buffers
				if (config) {
					for (const passName of Object.keys(config)) {
						if (passName === "version") continue;
						const pass = config[passName];
						if (typeof pass !== "object") continue;

						// Patch pass-level "path" (for buffer source files)
						if (pass.path && typeof pass.path === "string") {
							const bufferPath = path.isAbsolute(pass.path)
								? pass.path
								: path.join(path.dirname(shaderPath), pass.path);

							// Check if we have this buffer in memory first
							const bufferDoc = vscode.workspace.textDocuments.find(
								(doc) => doc.fileName === bufferPath,
							);

							// log buffer loading
							outputChannel.debug(
								`Processing buffer for pass ${passName}: ${bufferPath}`,
							);
							// log filenames
							outputChannel.debug(
								`Buffer file name: ${path.basename(bufferPath)}`,
							);

							if (bufferDoc) {
								// Get content from memory directly
								const bufferContent = bufferDoc.getText();

								// output code
								outputChannel.debug(
									bufferContent,
								);

								buffers[passName] = bufferContent;

								outputChannel.debug(
									`Loaded buffer content from memory for ${passName}`,
								);
							} else if (fs.existsSync(bufferPath)) {
								// Read buffer file content from disk
								try {
									const bufferContent = fs.readFileSync(bufferPath, "utf-8");
									buffers[passName] = bufferContent;

									// Removed hash calculation
									outputChannel.debug(
										`Loaded buffer content from disk for ${passName}: ${bufferPath}`,
									);
								} catch (e) {
									outputChannel.warn(
										`Failed to read buffer content for ${passName}: ${bufferPath}`,
									);
								}
							}

							// Always update webview URI (doesn't affect performance)
							const webviewUri = panel.webview.asWebviewUri(
								vscode.Uri.file(bufferPath),
							);
							pass.path = webviewUri.toString();
						}

						// Process inputs similar to original code
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
				}
			} catch (e) {
				vscode.window.showWarningMessage(
					`Failed to parse config: ${configPath}`,
				);
				config = null;
			}
		}

		// This builds a map of which buffers are used by which shaders
		if (config) {
			// Record which buffer files are used by this shader
			const bufferFiles = new Set<string>();

			for (const passName of Object.keys(config)) {
				if (passName === "version") continue;
				const pass = config[passName];
				if (typeof pass !== "object") continue;

				if (pass.path && typeof pass.path === "string") {
					const bufferPath = path.isAbsolute(pass.path)
						? pass.path
						: path.join(path.dirname(shaderPath), pass.path);

					bufferFiles.add(bufferPath);
				}
			}

			// Update our tracking map
			shaderBuffersMap.set(shaderPath, bufferFiles);
		}

		// Calculate hashes or use stringified versions with minimal whitespace to detect changes
		const configStr = JSON.stringify(config);

		// Always update the shader - no change detection
		outputChannel.debug(`Sending shader update (${name})`);
		outputChannel.debug(`Sending ${Object.keys(buffers).length} buffer(s)`);

		// Update lastSent for potential future use
		lastSent = {
			code,
			config: configStr,
			name,
			isLocked,
		};

		panel.webview.postMessage({
			type: "shaderSource",
			code,
			config,
			name,
			isLocked,
			buffers,
		});
		outputChannel.debug("Shader message sent to webview");
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
						outputChannel.info(logText);

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
						let errorText = message.payload.join
							? message.payload.join(" ")
							: message.payload;
						errorText = errorText.slice(0, -1);
						outputChannel.error(errorText);

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

					if (message.type === "toggleLock") {
						vscode.commands.executeCommand("shader-view.toggleLock");
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

	context.subscriptions.push(
		vscode.commands.registerCommand("shader-view.toggleLock", () => {
			isLocked = !isLocked;
			if (isLocked && currentlyPreviewedEditor) {
				lockedEditor = currentlyPreviewedEditor;
				sendShaderToWebview(currentlyPreviewedEditor);
			} else {
				lockedEditor = undefined;
				// If unlocked, find the most recently accessed GLSL file
				const glslTabs = vscode.window.tabGroups.all
					.flatMap((group) => group.tabs)
					.filter((tab) => {
						if (tab.input instanceof vscode.TabInputText) {
							const uri = tab.input.uri;
							return uri.fsPath.endsWith(".glsl") ||
								vscode.workspace.textDocuments.find((doc) =>
									doc.uri.fsPath === uri.fsPath && doc.languageId === "glsl"
								);
						}
						return false;
					})
					.sort((a, b) => {
						// Sort by most recently active (activeTab first, then by tab order)
						if (a.isActive) return -1;
						if (b.isActive) return 1;
						return 0;
					});

				if (
					glslTabs.length > 0 &&
					glslTabs[0].input instanceof vscode.TabInputText
				) {
					// Find the editor for the most recent GLSL tab
					const mostRecentGlslUri = glslTabs[0].input.uri;
					const mostRecentEditor = vscode.window.visibleTextEditors.find(
						(editor) => editor.document.uri.fsPath === mostRecentGlslUri.fsPath,
					);

					if (mostRecentEditor) {
						sendShaderToWebview(mostRecentEditor);
					} else if (
						vscode.window.activeTextEditor?.document.languageId === "glsl"
					) {
						// Fallback to active editor if it's GLSL
						sendShaderToWebview(vscode.window.activeTextEditor);
					}
				} else if (
					vscode.window.activeTextEditor?.document.languageId === "glsl"
				) {
					// Fallback to active editor if it's GLSL
					sendShaderToWebview(vscode.window.activeTextEditor);
				}
			}
		}),
	);

	// 🧭 Update shader when switching active editor
	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor) sendShaderToWebview(editor);
	});

	// ⌨️ Update shader as it's edited
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
			sendShaderToWebview(editor);
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

// Add a simple hash function
function computeSimpleHash(content: string): string {
	// A simple hash function that's fast but effective enough for change detection
	let hash = 0;
	for (let i = 0; i < content.length; i++) {
		const char = content.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash.toString(36);
}

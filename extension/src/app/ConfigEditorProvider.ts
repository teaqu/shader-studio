import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { ShaderProvider } from "./ShaderProvider";
import { Constants } from "./Constants";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import type { ShaderConfig } from "@shader-studio/types";

export class ConfigEditorProvider implements vscode.CustomTextEditorProvider {
    private logger: Logger;

    constructor(
        private context: vscode.ExtensionContext,
        private shaderProcessor?: ShaderProvider,
    ) {
        this.logger = Logger.getInstance();
    }

    public static register(
        context: vscode.ExtensionContext,
        shaderProvider?: ShaderProvider,
    ): vscode.Disposable {
        const provider = new ConfigEditorProvider(context, shaderProvider);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            Constants.CONFIG_EDITOR_VIEW_TYPE,
            provider,
        );
        return providerRegistration;
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        // Get workspace folders for resource access
        const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri) || [];
        // Get the directory containing the config file
        const configDir = vscode.Uri.file(path.dirname(document.uri.fsPath));

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(
                    path.join(this.context.extensionPath, "config-ui-dist"),
                ),
                configDir,
                ...workspaceFolders,
            ],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
        );

        function updateWebview() {
            const configText = document.getText();
            const pathMap: Record<string, string> = {};

            // Create a map of original paths to webview URIs for previews
            try {
                if (configText.trim()) {
                    const config: ShaderConfig = JSON.parse(configText);
                    const configDir = path.dirname(document.uri.fsPath);

                    // Collect all texture/video paths and convert them
                    for (const passName of Object.keys(config.passes || {})) {
                        const pass = config.passes[passName as keyof typeof config.passes];
                        if (pass && typeof pass === 'object' && 'inputs' in pass) {
                            const inputs = pass.inputs;
                            if (inputs) {
                                for (const key of Object.keys(inputs)) {
                                    const input = inputs[key as keyof typeof inputs];
                                    if (input && typeof input === 'object' && 'path' in input && input.path) {
                                        const originalPath = input.path as string;
                                        // Resolve relative path to absolute
                                        const absolutePath = path.isAbsolute(originalPath)
                                            ? originalPath
                                            : path.join(configDir, originalPath);
                                        // Convert to webview URI
                                        const webviewUri = ConfigPathConverter.convertUriForClient(absolutePath, webviewPanel.webview);
                                        pathMap[originalPath] = webviewUri;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to process config paths:", error);
            }

            webviewPanel.webview.postMessage({
                type: "update",
                text: configText,
                pathMap: pathMap
            });
        }

        let refreshTimeout: ReturnType<typeof setTimeout> | undefined;

        const triggerShaderRefresh = () => {
            if (!this.shaderProcessor) {
                return;
            }

            const configPath = document.uri.fsPath;
            let shaderPath = configPath.replace(/\.sha\.json$/i, ".glsl");
            if (!fs.existsSync(shaderPath)) {
                const fragPath = configPath.replace(/\.sha\.json$/i, ".frag");
                if (fs.existsSync(fragPath)) {
                    shaderPath = fragPath;
                }
            }

            // Use editor if visible (to capture unsaved shader changes), otherwise read from disk
            const visibleShaderEditor = vscode.window.visibleTextEditors.find(
                (editor) => editor.document.uri.fsPath === shaderPath,
            );

            if (visibleShaderEditor) {
                this.shaderProcessor.sendShaderToWebview(visibleShaderEditor, { forceCleanup: true });
            } else {
                this.shaderProcessor.sendShaderFromPath(shaderPath, { forceCleanup: true });
            }
        };

        const changeDocumentSubscription = vscode.workspace
            .onDidChangeTextDocument(
                (e) => {
                    if (e.document.uri.toString() === document.uri.toString()) {
                        updateWebview();

                        if (refreshTimeout) {
                            clearTimeout(refreshTimeout);
                        }
                        refreshTimeout = setTimeout(() => {
                            triggerShaderRefresh();
                        }, 150);
                    }
                },
            );

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();

            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }
        });

        // Update webview when it becomes visible again
        webviewPanel.onDidChangeViewState(() => {
            if (webviewPanel.visible) {
                updateWebview();
            }
        });

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage((e) => {
            switch (e.type) {
                case "add":
                    this.addNewEntry(document);
                    return;

                case "delete":
                    this.deleteEntry(document, e.id);
                    return;

                case "updateConfig":
                    this.updateTextDocumentFromText(document, e.text);
                    return;
            }
        });

        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // Read the built HTML file
        const htmlPath = path.join(
            this.context.extensionPath,
            "config-ui-dist",
            "index.html",
        );

        this.logger.debug(`Loading config editor HTML from: ${htmlPath}`);

        const rawHtml = fs.readFileSync(htmlPath, "utf-8");
        this.logger.debug(`Successfully loaded config editor HTML`);

        const processedHtml = rawHtml.replace(
            /(src|href)="\.?\/([^"]+)"/g,
            (_, attr, file) => {
                const filePath = path.join(
                    this.context.extensionPath,
                    "config-ui-dist",
                    file,
                );
                const uri = webview.asWebviewUri(vscode.Uri.file(filePath));
                this.logger.debug(`Mapped ${file} to ${uri.toString()}`);
                return `${attr}="${uri}"`;
            },
        );

        return processedHtml;
    }

    private addNewEntry(document: vscode.TextDocument) {
        const json = this.getDocumentAsJson(document);
        const character = json.BufferA ? "BufferB" : "BufferA";
        json[character] = {
            path: `${character.toLowerCase()}.glsl`,
            inputs: {},
        };
        return this.updateTextDocument(document, json);
    }

    private deleteEntry(document: vscode.TextDocument, id: string) {
        const json = this.getDocumentAsJson(document);
        if (!json[id]) {
            return;
        }

        delete json[id];
        return this.updateTextDocument(document, json);
    }

    /**
     * Update document from text string
     */
    private updateTextDocumentFromText(
        document: vscode.TextDocument,
        text: string,
    ): Thenable<boolean> {
        const edit = new vscode.WorkspaceEdit();

        // Replace the entire document with the new text
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            text,
        );

        return vscode.workspace.applyEdit(edit);
    } /**
     * Get the static html used for the editor webviews.
     */

    private getDocumentAsJson(document: vscode.TextDocument): any {
        const text = document.getText();
        if (text.trim().length === 0) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch {
            throw new Error(
                "Could not get document as json. Content is not valid json",
            );
        }
    }

    /**
     * Write out the json to a given document.
     */
    private updateTextDocument(
        document: vscode.TextDocument,
        json: any,
    ): Thenable<boolean> {
        const edit = new vscode.WorkspaceEdit();

        // Just replace the entire document every time for this example extension.
        // A more complete extension should compute minimal edits instead.
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(json, null, 2),
        );

        return vscode.workspace.applyEdit(edit);
    }
}

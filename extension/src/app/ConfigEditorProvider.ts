import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { ShaderProvider } from "./ShaderProvider";
import { Constants } from "./Constants";

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
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(
                    path.join(this.context.extensionPath, "config-ui-dist"),
                ),
            ],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
        );

        function updateWebview() {
            webviewPanel.webview.postMessage({
                type: "update",
                text: document.getText(),
            });
        }

        const changeDocumentSubscription = vscode.workspace
            .onDidChangeTextDocument(
                (e) => {
                    if (e.document.uri.toString() === document.uri.toString()) {
                        updateWebview();
                    }
                },
            );

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
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

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { ShaderCreator } from "./ShaderCreator";

interface SnippetEntry {
    prefix: string;
    body: string | string[];
    description: string;
    call?: string;
    example?: string | string[];
}

interface SnippetFile {
    [name: string]: SnippetEntry;
}

type SnippetCategory =
    | "sdf-2d"
    | "sdf-3d"
    | "math"
    | "coordinates"
    | "custom";

const SNIPPET_FILE_CATEGORIES: Record<string, SnippetCategory> = {
    "sdf-2d.code-snippets": "sdf-2d",
    "sdf-3d.code-snippets": "sdf-3d",
    "math.code-snippets": "math",
    "coordinates.code-snippets": "coordinates",
};

export class SnippetLibraryProvider {
    private logger: Logger;
    private panel: vscode.WebviewPanel | undefined;
    private shaderCreator: ShaderCreator;
    private lastActiveEditor: vscode.TextEditor | undefined;
    private editorChangeDisposable: vscode.Disposable | undefined;

    constructor(private context: vscode.ExtensionContext, shaderCreator: ShaderCreator) {
        this.logger = Logger.getInstance();
        this.shaderCreator = shaderCreator;

        // Track the last active text editor so we can insert into it
        // even when the snippet library panel has focus
        this.lastActiveEditor = vscode.window.activeTextEditor;
        this.editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.lastActiveEditor = editor;
            }
        });
        context.subscriptions.push(this.editorChangeDisposable);
    }

    public static register(
        context: vscode.ExtensionContext,
        shaderCreator: ShaderCreator,
    ): vscode.Disposable {
        const provider = new SnippetLibraryProvider(context, shaderCreator);

        const command = vscode.commands.registerCommand(
            "shader-studio.openSnippetLibrary",
            () => {
                provider.show();
            },
        );

        return command;
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            "shader-studio.snippetLibrary",
            "Snippet Library",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(
                        path.join(
                            this.context.extensionPath,
                            "snippet-library-dist",
                        ),
                    ),
                ],
            },
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        this.panel.webview.onDidReceiveMessage(async (message) => {
            this.logger.debug(
                `SnippetLibrary: Received message: ${message.type}`,
            );
            switch (message.type) {
                case "requestSnippets":
                    await this.sendSnippets();
                    break;

                case "insertSnippet":
                    await this.insertSnippet(message.body);
                    break;

                case "saveCustomSnippet":
                    await this.saveCustomSnippet(
                        message.name,
                        message.prefix,
                        message.body,
                        message.description,
                        message.call,
                        message.example,
                    );
                    break;

                case "updateCustomSnippet":
                    await this.updateCustomSnippet(
                        message.oldName,
                        message.name,
                        message.prefix,
                        message.body,
                        message.description,
                        message.call,
                        message.example,
                    );
                    break;

                case "deleteCustomSnippet":
                    await this.deleteCustomSnippet(message.name);
                    break;

                case "createScene":
                    await this.shaderCreator.createFromTemplate(
                        message.shaderCode,
                    );
                    break;

                case "saveState":
                    await this.context.workspaceState.update(
                        "snippetLibrary.state",
                        message.state,
                    );
                    break;
            }
        });

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
    }

    private async sendSnippets(): Promise<void> {
        if (!this.panel) return;

        const snippets: any[] = [];

        // Load built-in snippets
        const snippetsDir = path.join(
            this.context.extensionPath,
            "snippets",
        );

        for (const [fileName, category] of Object.entries(
            SNIPPET_FILE_CATEGORIES,
        )) {
            const filePath = path.join(snippetsDir, fileName);
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, "utf-8");
                    const parsed: SnippetFile = JSON.parse(content);
                    for (const [name, entry] of Object.entries(parsed)) {
                        const body = Array.isArray(entry.body)
                            ? entry.body
                            : [entry.body];
                        const example = entry.example
                            ? Array.isArray(entry.example)
                                ? entry.example
                                : [entry.example]
                            : undefined;
                        snippets.push({
                            name,
                            prefix: entry.prefix,
                            body,
                            description: entry.description || "",
                            call: entry.call,
                            example,
                            category,
                            isCustom: false,
                        });
                    }
                }
            } catch (err) {
                this.logger.error(
                    `Failed to load snippet file ${fileName}: ${err}`,
                );
            }
        }

        // Load custom snippets from workspace
        const customSnippets = await this.loadCustomSnippets();
        snippets.push(...customSnippets);

        const savedState = this.context.workspaceState.get(
            "snippetLibrary.state",
            null,
        );

        this.panel.webview.postMessage({
            type: "snippetsUpdate",
            snippets,
            savedState,
        });
    }

    private async loadCustomSnippets(): Promise<any[]> {
        const snippets: any[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return snippets;

        for (const folder of workspaceFolders) {
            const customPath = path.join(
                folder.uri.fsPath,
                ".vscode",
                "glsl-snippets.code-snippets",
            );

            try {
                if (fs.existsSync(customPath)) {
                    const content = fs.readFileSync(customPath, "utf-8");
                    const parsed: SnippetFile = JSON.parse(content);
                    for (const [name, entry] of Object.entries(parsed)) {
                        const body = Array.isArray(entry.body)
                            ? entry.body
                            : [entry.body];
                        const example = entry.example
                            ? Array.isArray(entry.example)
                                ? entry.example
                                : [entry.example]
                            : undefined;
                        snippets.push({
                            name,
                            prefix: entry.prefix,
                            body,
                            description: entry.description || "",
                            call: entry.call,
                            example,
                            category: "custom",
                            isCustom: true,
                        });
                    }
                }
            } catch (err) {
                this.logger.error(
                    `Failed to load custom snippets: ${err}`,
                );
            }
        }

        return snippets;
    }

    private async insertSnippet(body: string[]): Promise<void> {
        let editor = vscode.window.activeTextEditor;
        if (!editor && this.lastActiveEditor) {
            // Snippet browser has focus — reveal the last active editor and use its new reference
            editor = await vscode.window.showTextDocument(
                this.lastActiveEditor.document,
                this.lastActiveEditor.viewColumn,
            );
        }
        if (!editor) {
            vscode.window.showWarningMessage(
                "No active editor. Open a GLSL file first.",
            );
            return;
        }

        try {
            const snippetString = new vscode.SnippetString(body.join("\n"));
            await editor.insertSnippet(snippetString);
        } catch (err) {
            this.logger.error(`Failed to insert snippet: ${err}`);
            vscode.window.showErrorMessage(`Failed to insert snippet: ${err}`);
        }
    }

    private getCustomSnippetsPath(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return null;

        return path.join(
            workspaceFolders[0].uri.fsPath,
            ".vscode",
            "glsl-snippets.code-snippets",
        );
    }

    private readCustomSnippetsFile(): SnippetFile {
        const filePath = this.getCustomSnippetsPath();
        if (!filePath || !fs.existsSync(filePath)) return {};

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            return JSON.parse(content);
        } catch {
            return {};
        }
    }

    private writeCustomSnippetsFile(data: SnippetFile): void {
        const filePath = this.getCustomSnippetsPath();
        if (!filePath) {
            vscode.window.showErrorMessage(
                "No workspace folder found. Open a folder first.",
            );
            return;
        }

        // Ensure .vscode directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    }

    private async saveCustomSnippet(
        name: string,
        prefix: string,
        body: string[],
        description: string,
        call?: string,
        example?: string[],
    ): Promise<void> {
        try {
            const data = this.readCustomSnippetsFile();
            const entry: SnippetEntry = { prefix, body, description };
            if (call) entry.call = call;
            if (example && example.length > 0) entry.example = example;
            data[name] = entry;
            this.writeCustomSnippetsFile(data);
            await this.sendSnippets();
        } catch (err) {
            this.logger.error(`Failed to save custom snippet: ${err}`);
            vscode.window.showErrorMessage(
                `Failed to save custom snippet: ${err}`,
            );
        }
    }

    private async updateCustomSnippet(
        oldName: string,
        name: string,
        prefix: string,
        body: string[],
        description: string,
        call?: string,
        example?: string[],
    ): Promise<void> {
        try {
            const data = this.readCustomSnippetsFile();
            if (oldName !== name) {
                delete data[oldName];
            }
            const entry: SnippetEntry = { prefix, body, description };
            if (call) entry.call = call;
            if (example && example.length > 0) entry.example = example;
            data[name] = entry;
            this.writeCustomSnippetsFile(data);
            await this.sendSnippets();
        } catch (err) {
            this.logger.error(`Failed to update custom snippet: ${err}`);
            vscode.window.showErrorMessage(
                `Failed to update custom snippet: ${err}`,
            );
        }
    }

    private async deleteCustomSnippet(name: string): Promise<void> {
        try {
            const data = this.readCustomSnippetsFile();
            delete data[name];
            this.writeCustomSnippetsFile(data);
            await this.sendSnippets();
        } catch (err) {
            this.logger.error(`Failed to delete custom snippet: ${err}`);
            vscode.window.showErrorMessage(
                `Failed to delete custom snippet: ${err}`,
            );
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const htmlPath = path.join(
            this.context.extensionPath,
            "snippet-library-dist",
            "index.html",
        );

        this.logger.debug(
            `Loading snippet library HTML from: ${htmlPath}`,
        );

        if (!fs.existsSync(htmlPath)) {
            this.logger.error(
                `Snippet Library HTML not found at: ${htmlPath}`,
            );
            return `
                <html>
                    <body>
                        <h1>Error</h1>
                        <p>Snippet Library UI not found. Please rebuild the extension.</p>
                        <p>Expected at: ${htmlPath}</p>
                    </body>
                </html>
            `;
        }

        const rawHtml = fs.readFileSync(htmlPath, "utf-8");

        const processedHtml = rawHtml.replace(
            /(src|href)="\.?\/([^"]+)"/g,
            (_, attr, file) => {
                const filePath = path.join(
                    this.context.extensionPath,
                    "snippet-library-dist",
                    file,
                );
                const uri = webview.asWebviewUri(vscode.Uri.file(filePath));
                return `${attr}="${uri}"`;
            },
        );

        // Inject or update CSP
        const cspPattern =
            /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']+)["'][^>]*>/i;
        const cspMatch = processedHtml.match(cspPattern);

        if (cspMatch) {
            const existingCsp = cspMatch[1];

            const scriptSrc = `script-src 'self' 'unsafe-inline' ${webview.cspSource}`;
            const styleSrc = `style-src 'self' 'unsafe-inline' ${webview.cspSource}`;
            const imgSrc = `img-src 'self' data: blob: ${webview.cspSource}`;
            const fontSrc = `font-src 'self' data: ${webview.cspSource}`;

            let updatedCsp = existingCsp;
            updatedCsp = updatedCsp.includes("script-src")
                ? updatedCsp.replace(/script-src[^;]*/, scriptSrc)
                : `${updatedCsp}; ${scriptSrc}`;
            updatedCsp = updatedCsp.includes("style-src")
                ? updatedCsp.replace(/style-src[^;]*/, styleSrc)
                : `${updatedCsp}; ${styleSrc}`;
            updatedCsp = updatedCsp.includes("img-src")
                ? updatedCsp.replace(/img-src[^;]*/, imgSrc)
                : `${updatedCsp}; ${imgSrc}`;
            updatedCsp = updatedCsp.includes("font-src")
                ? updatedCsp.replace(/font-src[^;]*/, fontSrc)
                : `${updatedCsp}; ${fontSrc}`;

            return processedHtml.replace(
                cspPattern,
                `<meta http-equiv="Content-Security-Policy" content="${updatedCsp}">`,
            );
        } else {
            const newCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' ${webview.cspSource}; style-src 'self' 'unsafe-inline' ${webview.cspSource}; img-src 'self' data: blob: ${webview.cspSource}; font-src 'self' data: ${webview.cspSource}; connect-src 'self';">`;

            const headMatch = processedHtml.match(/<head[^>]*>/i);
            if (headMatch) {
                const headIndex = processedHtml.indexOf(headMatch[0]);
                const afterHeadIndex = headIndex + headMatch[0].length;

                return (
                    processedHtml.slice(0, afterHeadIndex) +
                    `\n    ${newCsp}` +
                    processedHtml.slice(afterHeadIndex)
                );
            }

            return processedHtml;
        }
    }
}

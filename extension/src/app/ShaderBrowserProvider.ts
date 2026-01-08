import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import type { ShaderConfig } from "@shader-studio/types";

export class ShaderBrowserProvider {
    private logger: Logger;
    private panel: vscode.WebviewPanel | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
    }

    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new ShaderBrowserProvider(context);

        const command = vscode.commands.registerCommand(
            "shader-studio.openShaderBrowser",
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

        // Get workspace folders for texture loading
        const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];

        this.panel = vscode.window.createWebviewPanel(
            "shader-studio.shaderBrowser",
            "Shader Browser",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(
                        path.join(
                            this.context.extensionPath,
                            "shader-browser-dist",
                        ),
                    ),
                    ...workspaceFolders,
                ],
            },
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            this.logger.debug(`Received message from webview: ${message.type}`);
            switch (message.type) {
                case "requestShaders":
                    await this.sendShaderList();
                    break;

                case "requestShaderCode":
                    await this.sendShaderCode(message.path);
                    break;

                case "openShader":
                    await this.openShader(message.path);
                    break;

                case "openConfig":
                    await this.openConfig(message.path);
                    break;

                case "createConfig":
                    await this.createConfig(message.shaderPath);
                    break;
            }
        });

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
    }

    private async sendShaderList(): Promise<void> {
        if (!this.panel) {
            return;
        }

        const shaders = await this.findAllShaders();
        this.logger.debug(`Found ${shaders.length} shaders`);
        this.panel.webview.postMessage({
            type: "shadersUpdate",
            shaders: shaders,
        });
    }

    private async sendShaderCode(shaderPath: string): Promise<void> {
        if (!this.panel) {
            return;
        }

        try {
            const doc = await vscode.workspace.openTextDocument(shaderPath);
            const code = doc.getText();
            
            // Collect buffer contents
            const buffers: Record<string, string> = {};
            
            // Load and process config
            const config = ShaderConfigProcessor.loadAndProcessConfig(shaderPath, buffers);

            this.logger.debug(`Sending shader code for ${shaderPath} with ${Object.keys(buffers).length} buffer(s)`);

            // Process config paths to convert texture paths to webview URIs
            const message = {
                type: "shaderCode",
                path: shaderPath,
                code: code,
                config: config,
                buffers: buffers,
            };

            const processedMessage = config
                ? ConfigPathConverter.processConfigPaths(message as any, this.panel.webview)
                : message;

            this.panel.webview.postMessage(processedMessage);
        } catch (error) {
            this.logger.error(`Failed to load shader code: ${error}`);
        }
    }

    private async findAllShaders(): Promise<any[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const shaders: any[] = [];

        for (const folder of workspaceFolders) {
            // Find all .glsl, .frag, .vert shader files
            const glslFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, "**/*.{glsl,frag,vert}"),
                "**/node_modules/**",
            );

            for (const file of glslFiles) {
                const relativePath = vscode.workspace.asRelativePath(file);
                const fileName = path.basename(file.fsPath);

                // Check if config file exists
                const configPath = this.getConfigPath(file.fsPath);
                const hasConfig = fs.existsSync(configPath);

                // Get file stats for timestamps
                let modifiedTime: number | undefined;
                let createdTime: number | undefined;
                try {
                    const stats = fs.statSync(file.fsPath);
                    modifiedTime = stats.mtimeMs;
                    createdTime = stats.birthtimeMs;
                } catch (e) {
                    this.logger.warn(`Failed to get file stats for ${file.fsPath}`);
                }

                shaders.push({
                    name: fileName,
                    path: file.fsPath,
                    relativePath: relativePath,
                    configPath: hasConfig ? configPath : undefined,
                    hasConfig: hasConfig,
                    modifiedTime: modifiedTime,
                    createdTime: createdTime,
                });
            }
        }

        // Sort by name
        shaders.sort((a, b) => a.name.localeCompare(b.name));

        return shaders;
    }

    private getConfigPath(shaderPath: string): string {
        return ShaderConfigProcessor.getConfigPath(shaderPath);
    }

    private async openShader(shaderPath: string): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(shaderPath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to open shader: ${error}`,
            );
        }
    }

    private async openConfig(configPath: string): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to open config: ${error}`,
            );
        }
    }

    private async createConfig(shaderPath: string): Promise<void> {
        try {
            // Use the existing generateConfig command
            await vscode.commands.executeCommand(
                "shader-studio.generateConfig",
                vscode.Uri.file(shaderPath),
            );

            // Refresh the shader list
            await this.sendShaderList();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to create config: ${error}`,
            );
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const htmlPath = path.join(
            this.context.extensionPath,
            "shader-browser-dist",
            "index.html",
        );

        this.logger.debug(`Loading shader browser HTML from: ${htmlPath}`);

        if (!fs.existsSync(htmlPath)) {
            this.logger.error(`Shader browser HTML not found at: ${htmlPath}`);
            return `
                <html>
                    <body>
                        <h1>Error</h1>
                        <p>Shader browser UI not found. Please rebuild the extension.</p>
                        <p>Expected at: ${htmlPath}</p>
                    </body>
                </html>
            `;
        }

        const rawHtml = fs.readFileSync(htmlPath, "utf-8");
        this.logger.debug(`Successfully loaded shader browser HTML`);

        const processedHtml = rawHtml.replace(
            /(src|href)="\.?\/([^"]+)"/g,
            (_, attr, file) => {
                const filePath = path.join(
                    this.context.extensionPath,
                    "shader-browser-dist",
                    file,
                );
                const uri = webview.asWebviewUri(vscode.Uri.file(filePath));
                this.logger.debug(`Mapped ${file} to ${uri.toString()}`);
                return `${attr}="${uri}"`;
            },
        );

        return processedHtml;
    }
}

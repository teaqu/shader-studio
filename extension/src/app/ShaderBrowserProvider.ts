import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { PathResolver } from "./PathResolver";
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
            
            // Check if config exists and load it
            const configPath = this.getConfigPath(shaderPath);
            let config: ShaderConfig | null = null;
            const buffers: Record<string, string> = {};
            
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf-8');
                config = JSON.parse(configContent);
                
                // Load buffer shaders referenced in the config
                if (config) {
                    this.processBuffers(config, shaderPath, buffers);
                }
            }

            this.logger.debug(`Sending shader code for ${shaderPath} with ${Object.keys(buffers).length} buffer(s)`);

            this.panel.webview.postMessage({
                type: "shaderCode",
                path: shaderPath,
                code: code,
                config: config,
                buffers: buffers,
            });
        } catch (error) {
            this.logger.error(`Failed to load shader code: ${error}`);
        }
    }

    private processBuffers(
        config: ShaderConfig,
        shaderPath: string,
        buffers: Record<string, string>,
    ): void {
        if (!config.passes) {
            return;
        }

        for (const passName of Object.keys(config.passes) as Array<keyof typeof config.passes>) {
            const pass = config.passes[passName];
            if (!pass || typeof pass !== "object") {
                continue;
            }

            // Process pass-level "path" (for buffer source files)
            if ("path" in pass && pass.path && typeof pass.path === "string") {
                this.processBufferPath(pass, passName, shaderPath, buffers);
            }
        }
    }

    private processBufferPath(
        pass: any,
        passName: string,
        shaderPath: string,
        buffers: Record<string, string>,
    ): void {
        const bufferPath = PathResolver.resolvePath(shaderPath, pass.path);

        this.logger.debug(`Processing buffer for pass ${passName}: ${bufferPath}`);

        if (fs.existsSync(bufferPath)) {
            try {
                const bufferContent = fs.readFileSync(bufferPath, "utf-8");
                buffers[passName] = bufferContent;
                this.logger.debug(`Loaded buffer content for ${passName}: ${bufferPath}`);
            } catch (e) {
                this.logger.warn(`Failed to read buffer content for ${passName}: ${bufferPath}`);
                vscode.window.showErrorMessage(`Failed to read buffer file: ${bufferPath}`);
            }
        } else {
            this.logger.error(`Buffer file not found for ${passName}: ${bufferPath}`);
            vscode.window.showErrorMessage(`Buffer file not found: ${bufferPath}`);
        }

        pass.path = bufferPath;
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
        const dir = path.dirname(shaderPath);
        const baseName = path.basename(shaderPath, path.extname(shaderPath));
        return path.join(dir, `${baseName}.sha.json`);
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

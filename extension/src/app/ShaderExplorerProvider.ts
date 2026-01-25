import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import { ThumbnailCache } from "./ThumbnailCache";

export class ShaderExplorerProvider {
    private logger: Logger;
    private panel: vscode.WebviewPanel | undefined;
    private thumbnailCache: ThumbnailCache;
    private configProcessor: ShaderConfigProcessor;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.thumbnailCache = new ThumbnailCache(context);
        this.configProcessor = new ShaderConfigProcessor();
    }

    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new ShaderExplorerProvider(context);

        const command = vscode.commands.registerCommand(
            "shader-studio.openShaderExplorer",
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
            "shader-studio.shaderExplorer",
            "Shader Explorer",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(
                        path.join(
                            this.context.extensionPath,
                            "shader-explorer-dist",
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
                    await this.sendShaderList(message.skipCache);
                    break;

                case "requestShaderCode":
                    await this.sendShaderCode(message.path);
                    break;

                case "saveThumbnail":
                    await this.saveThumbnail(message.path, message.thumbnail, message.modifiedTime);
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
                case "saveState":
                    // Save state to workspace storage
                    await this.context.workspaceState.update('shaderBrowser.state', message.state);
                    break;
            }
        });

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
    }

    private async sendShaderList(skipCache: boolean = false): Promise<void> {
        if (!this.panel) {
            return;
        }

        const shaders = await this.findAllShaders();
        this.logger.debug(`Found ${shaders.length} shaders`);
        
        // Add cached thumbnails to shader data (unless skipCache is true)
        const shadersWithThumbnails = shaders.map(shader => {
            if (skipCache) {
                this.logger.debug(`Skipping cache for ${shader.name} (refresh requested)`);
                return {
                    ...shader,
                    cachedThumbnail: null,
                };
            }
            
            const thumbnail = this.thumbnailCache.getThumbnail(shader.path, shader.modifiedTime);
            if (thumbnail) {
                this.logger.debug(`Found cached thumbnail for ${shader.name} (${thumbnail.length} chars)`);
            } else {
                this.logger.debug(`No cached thumbnail for ${shader.name}`);
            }
            return {
                ...shader,
                cachedThumbnail: thumbnail,
            };
        });

        // Prune old thumbnails in the background
        this.thumbnailCache.pruneCache(shaders.map(s => s.path)).catch(err => {
            this.logger.error(`Failed to prune thumbnail cache: ${err}`);
        });
        
        const savedState = this.context.workspaceState.get('shaderBrowser.state', null);
        
        this.panel.webview.postMessage({
            type: "shadersUpdate",
            shaders: shadersWithThumbnails,
            savedState: savedState,
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
            const config = this.configProcessor.loadAndProcessConfig(shaderPath, buffers);

            this.logger.debug(`Sending shader code for ${shaderPath} with ${Object.keys(buffers).length} buffer(s)`);

            // Process config paths to convert texture paths to webview URIs
            const message = {
                type: "shaderCode",
                path: shaderPath,
                code: code,
                config: config,
                buffers: buffers,
            };

            const processedMessage = ConfigPathConverter.processConfigPaths(
                message as any,
                this.panel.webview
            );

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
            const column = this.panel?.viewColumn ? this.panel.viewColumn + 1 : vscode.ViewColumn.Beside;
            await vscode.window.showTextDocument(doc, column);
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

    private async saveThumbnail(shaderPath: string, thumbnail: string, modifiedTime?: number): Promise<void> {
        try {
            const success = this.thumbnailCache.saveThumbnail(shaderPath, thumbnail, modifiedTime);
            if (success) {
                this.logger.debug(`Saved thumbnail for ${shaderPath}`);
            } else {
                this.logger.error(`Failed to save thumbnail for ${shaderPath}`);
            }
        } catch (error) {
            this.logger.error(`Error saving thumbnail: ${error}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const htmlPath = path.join(
            this.context.extensionPath,
            "shader-explorer-dist",
            "index.html",
        );

        this.logger.debug(`Loading shader explorer HTML from: ${htmlPath}`);

        if (!fs.existsSync(htmlPath)) {
            this.logger.error(`Shader Explorer HTML not found at: ${htmlPath}`);
            return `
                <html>
                    <body>
                        <h1>Error</h1>
                        <p>Shader Explorer UI not found. Please rebuild the extension.</p>
                        <p>Expected at: ${htmlPath}</p>
                    </body>
                </html>
            `;
        }

        const rawHtml = fs.readFileSync(htmlPath, "utf-8");
        this.logger.debug(`Successfully loaded shader explorer HTML`);

        const processedHtml = rawHtml.replace(
            /(src|href)="\.?\/([^"]+)"/g,
            (_, attr, file) => {
                const filePath = path.join(
                    this.context.extensionPath,
                    "shader-explorer-dist",
                    file,
                );
                const uri = webview.asWebviewUri(vscode.Uri.file(filePath));
                this.logger.debug(`Mapped ${file} to ${uri.toString()}`);
                return `${attr}="${uri}"`;
            },
        );

        // Inject or update CSP to allow loading from webview sources
        const cspPattern = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']+)["'][^>]*>/i;
        const cspMatch = processedHtml.match(cspPattern);
        
        console.log(`ShaderExplorerProvider: Webview CSP source: ${webview.cspSource}`);
        
        if (cspMatch) {
            // Update existing CSP to include webview.cspSource
            const existingCsp = cspMatch[1];
            console.log(`ShaderExplorerProvider: Found existing CSP: ${existingCsp}`);
            
            // Use the actual webview.cspSource for scripts and styles
            const scriptSrc = `script-src 'self' 'unsafe-inline' ${webview.cspSource}`;
            const styleSrc = `style-src 'self' 'unsafe-inline' ${webview.cspSource}`;
            const imgSrc = `img-src 'self' data: blob: ${webview.cspSource}`;
            const mediaSrc = `media-src 'self' blob: ${webview.cspSource}`;
            
            let updatedCsp = existingCsp;
            updatedCsp = updatedCsp.includes('script-src') 
                ? updatedCsp.replace(/script-src[^;]*/, scriptSrc)
                : `${updatedCsp}; ${scriptSrc}`;
            updatedCsp = updatedCsp.includes('style-src') 
                ? updatedCsp.replace(/style-src[^;]*/, styleSrc)
                : `${updatedCsp}; ${styleSrc}`;
            updatedCsp = updatedCsp.includes('img-src') 
                ? updatedCsp.replace(/img-src[^;]*/, imgSrc)
                : `${updatedCsp}; ${imgSrc}`;
            updatedCsp = updatedCsp.includes('media-src') 
                ? updatedCsp.replace(/media-src[^;]*/, mediaSrc)
                : `${updatedCsp}; ${mediaSrc}`;
            
            const finalHtml = processedHtml.replace(
                cspPattern,
                `<meta http-equiv="Content-Security-Policy" content="${updatedCsp}">`
            );
            console.log(`ShaderExplorerProvider: Updated CSP to: ${updatedCsp}`);
            this.logger.debug("Updated existing CSP for webview support");
            return finalHtml;
        } else {
            // Add CSP inside <head> tag
            const newCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' ${webview.cspSource}; style-src 'self' 'unsafe-inline' ${webview.cspSource}; img-src 'self' data: blob: ${webview.cspSource}; media-src 'self' blob: ${webview.cspSource}; font-src 'self'; connect-src 'self';">`;
            
            // Handle both <!doctype html> and <html> cases
            const doctypeMatch = processedHtml.match(/<!doctype html>/i);
            const htmlMatch = processedHtml.match(/<html[^>]*>/i);
            
            if (doctypeMatch && htmlMatch) {
                // Insert after <head> tag
                const headMatch = processedHtml.match(/<head[^>]*>/i);
                if (headMatch) {
                    const headIndex = processedHtml.indexOf(headMatch[0]);
                    const afterHeadIndex = headIndex + headMatch[0].length;
                    
                    const finalHtml = processedHtml.slice(0, afterHeadIndex) + 
                                   `\n    ${newCsp}` + 
                                   processedHtml.slice(afterHeadIndex);
                    
                    console.log(`ShaderExplorerProvider: Added CSP after <head> tag`);
                    return finalHtml;
                }
            }
            
            // Fallback: return original HTML if CSP injection fails
            console.log(`ShaderExplorerProvider: Failed to inject CSP, using original`);
            return processedHtml;
        }
    }
}

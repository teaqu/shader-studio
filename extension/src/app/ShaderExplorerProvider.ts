import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Logger } from "./services/Logger";
import { ShaderConfigProcessor } from "./ShaderConfigProcessor";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import { ThumbnailCache } from "./ThumbnailCache";
import { TabGroupResolver } from "./TabGroupResolver";
import { ShaderGitMetadataProvider } from "./ShaderGitMetadataProvider";

interface ShaderExplorerFile {
  name: string;
  path: string;
  relativePath: string;
  configPath?: string;
  hasConfig: boolean;
  cachedThumbnail?: string | null;
  modifiedTime?: number;
  createdTime?: number;
}

interface ShaderSearchCacheEntry {
  cacheKey: string;
  text: string;
}

interface ShaderSearchMatch {
  shader: ShaderExplorerFile;
  rank: number;
}

interface ShaderSearchQuery {
  include: string[];
  exclude: string[];
}

export class ShaderExplorerProvider {
  private logger: Logger;
  private panel: vscode.WebviewPanel | undefined;
  private thumbnailCache: ThumbnailCache;
  private configProcessor: ShaderConfigProcessor;
  private tabGroupResolver: TabGroupResolver;
  private gitMetadataProvider: Pick<ShaderGitMetadataProvider, "getMetadataForWorkspace">;
  private shaderListCache: ShaderExplorerFile[] = [];
  private shaderSearchTextCache = new Map<string, ShaderSearchCacheEntry>();
  private latestSearchRequestId = 0;
  private readonly shaderSearchConcurrency = 16;

  constructor(
    private context: vscode.ExtensionContext,
    gitMetadataProvider?: Pick<ShaderGitMetadataProvider, "getMetadataForWorkspace">,
  ) {
    this.logger = Logger.getInstance();
    this.thumbnailCache = new ThumbnailCache(context);
    this.configProcessor = new ShaderConfigProcessor();
    this.tabGroupResolver = new TabGroupResolver();
    this.gitMetadataProvider = gitMetadataProvider ?? new ShaderGitMetadataProvider(context);
    context.subscriptions.push(this.tabGroupResolver);
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

        case "searchShaders":
          await this.sendShaderSearchResults(message.query, message.requestId);
          break;

        case "saveThumbnail":
          await this.saveThumbnail(message.path, message.thumbnail, message.modifiedTime);
          break;

        case "openShader":
          await this.openShader(message.path);
          break;

        case "activateShader":
          await this.activateShader(message.path);
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
    this.shaderListCache = shaders;
    this.pruneShaderSearchCache(new Set(shaders.map(shader => shader.path)));
    this.logger.debug(`Found ${shaders.length} shaders`);
        
    // Add cached thumbnails to shader data (unless skipCache is true)
    const shadersWithThumbnails = shaders.map(shader => {
      if (skipCache) {
        return {
          ...shader,
          cachedThumbnail: null,
        };
      }
            
      const thumbnail = this.thumbnailCache.getThumbnail(shader.path, shader.modifiedTime);
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

      const processedMessage = await ConfigPathConverter.processConfigPaths(
                message as any,
                this.panel.webview
      );

      this.panel.webview.postMessage(processedMessage);
    } catch (error) {
      this.logger.error(`Failed to load shader code: ${error}`);
    }
  }

  private async sendShaderSearchResults(query: string, requestId?: number): Promise<void> {
    if (!this.panel) {
      return;
    }

    const searchRequestId = typeof requestId === "number"
      ? requestId
      : this.latestSearchRequestId + 1;
    this.latestSearchRequestId = searchRequestId;

    const normalizedQuery = typeof query === "string"
      ? query.trim().toLowerCase()
      : "";
    const parsedQuery = this.parseShaderSearchQuery(normalizedQuery);
    const shaders = this.shaderListCache.length > 0
      ? this.shaderListCache
      : await this.findAllShaders();

    if (this.shaderListCache.length === 0) {
      this.shaderListCache = shaders;
      this.pruneShaderSearchCache(new Set(shaders.map(shader => shader.path)));
    }

    const matches = await this.collectShaderSearchMatches(
      shaders,
      parsedQuery,
      searchRequestId,
    );
    if (!matches || !this.isLatestShaderSearch(searchRequestId)) {
      return;
    }

    matches.sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return a.shader.name.localeCompare(b.shader.name);
    });

    this.panel.webview.postMessage({
      type: "shaderSearchResults",
      query: query ?? "",
      requestId: searchRequestId,
      paths: matches.map(match => match.shader.path),
    });
  }

  private async collectShaderSearchMatches(
    shaders: ShaderExplorerFile[],
    query: ShaderSearchQuery,
    requestId: number,
  ): Promise<ShaderSearchMatch[] | null> {
    const matches: ShaderSearchMatch[] = [];
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (this.isLatestShaderSearch(requestId)) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= shaders.length) {
          return;
        }

        const shader = shaders[index];
        const rank = await this.getShaderSearchRank(shader, query);
        if (!this.isLatestShaderSearch(requestId)) {
          return;
        }

        if (rank !== null) {
          matches.push({ shader, rank });
        }
      }
    };

    const workerCount = Math.min(this.shaderSearchConcurrency, shaders.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return this.isLatestShaderSearch(requestId) ? matches : null;
  }

  private isLatestShaderSearch(requestId: number): boolean {
    return requestId === this.latestSearchRequestId;
  }

  private async getShaderSearchRank(shader: ShaderExplorerFile, query: ShaderSearchQuery): Promise<number | null> {
    if (query.include.length === 0 && query.exclude.length === 0) {
      return 0;
    }

    const name = shader.name.toLowerCase();
    const pathText = `${shader.relativePath} ${shader.path}`.toLowerCase();

    if (query.exclude.some(term => name.includes(term) || pathText.includes(term))) {
      return null;
    }

    let text: string | null = null;
    const getText = async (): Promise<string> => {
      text ??= await this.getShaderSearchText(shader);
      return text;
    };

    for (const term of query.exclude) {
      if ((await getText()).includes(term)) {
        return null;
      }
    }

    if (query.include.length === 0) {
      return 0;
    }

    let worstRank = 0;
    let rankSum = 0;
    for (const term of query.include) {
      const termRank = await this.getShaderSearchTermRank(term, name, pathText, getText);
      if (termRank === null) {
        return null;
      }

      worstRank = Math.max(worstRank, termRank);
      rankSum += termRank;
    }

    return worstRank * 100 + rankSum;
  }

  private async getShaderSearchTermRank(
    term: string,
    name: string,
    pathText: string,
    getText: () => Promise<string>,
  ): Promise<number | null> {
    if (name.includes(term)) {
      return 0;
    }

    if (pathText.includes(term)) {
      return 1;
    }

    return (await getText()).includes(term) ? 2 : null;
  }

  private parseShaderSearchQuery(query: string): ShaderSearchQuery {
    const include: string[] = [];
    const exclude: string[] = [];
    const tokenPattern = /(-?)"([^"]+)"|(-?)(\S+)/g;
    for (const match of query.matchAll(tokenPattern)) {
      const isExcluded = Boolean(match[1] || match[3]);
      const term = (match[2] ?? match[4] ?? "").trim().toLowerCase();
      if (!term || term === "-") {
        continue;
      }

      (isExcluded ? exclude : include).push(term);
    }

    return { include, exclude };
  }

  private async getShaderSearchText(shader: ShaderExplorerFile): Promise<string> {
    const openDocument = vscode.workspace.textDocuments.find(
      document => document.uri.fsPath === shader.path,
    );
    const cacheKey = openDocument
      ? `document:${openDocument.version}`
      : `file:${shader.modifiedTime ?? "unknown"}`;
    const cached = this.shaderSearchTextCache.get(shader.path);
    if (cached && cached.cacheKey === cacheKey) {
      return cached.text;
    }

    if (openDocument) {
      const text = openDocument.getText().toLowerCase();
      this.shaderSearchTextCache.set(shader.path, {
        cacheKey,
        text,
      });
      return text;
    }

    try {
      const contents = await fs.promises.readFile(shader.path, "utf8");
      const text = contents.toString().toLowerCase();
      this.shaderSearchTextCache.set(shader.path, {
        cacheKey,
        text,
      });
      return text;
    } catch (error) {
      this.logger.warn(`Failed to read shader text for search: ${shader.path} (${error})`);
      this.shaderSearchTextCache.set(shader.path, {
        cacheKey,
        text: "",
      });
      return "";
    }
  }

  private pruneShaderSearchCache(activePaths: Set<string>): void {
    for (const path of this.shaderSearchTextCache.keys()) {
      if (!activePaths.has(path)) {
        this.shaderSearchTextCache.delete(path);
      }
    }
  }

  private async findAllShaders(): Promise<ShaderExplorerFile[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const shaders: ShaderExplorerFile[] = [];

    for (const folder of workspaceFolders) {
      // Find all .glsl, .frag, .vert shader files
      const glslFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.{glsl,frag,vert}"),
        "**/node_modules/**",
      );
      const shaderPaths = glslFiles.map(file => file.fsPath);
      const gitMetadataResult = await this.gitMetadataProvider.getMetadataForWorkspace(
        folder.uri.fsPath,
        shaderPaths,
      );

      for (const file of glslFiles) {
        const relativePath = vscode.workspace.asRelativePath(file);
        const fileName = path.basename(file.fsPath);
        const repoRelativePath = gitMetadataResult
          ? path.relative(gitMetadataResult.repoRoot, file.fsPath).replace(/\\/g, "/")
          : undefined;
        const gitMetadata = repoRelativePath
          ? gitMetadataResult!.metadataByPath.get(repoRelativePath)
          : undefined;
        const isDirty = repoRelativePath
          ? gitMetadataResult!.dirtyPaths.has(repoRelativePath)
          : false;

        // Check if config file exists
        const configPath = this.getConfigPath(file.fsPath);
        const hasConfig = fs.existsSync(configPath);

        // Get file stats for timestamps
        let filesystemModifiedTime: number | undefined;
        let filesystemCreatedTime: number | undefined;
        try {
          const stats = fs.statSync(file.fsPath);
          filesystemModifiedTime = stats.mtimeMs;
          filesystemCreatedTime = stats.birthtimeMs;
        } catch (e) {
          this.logger.warn(`Failed to get file stats for ${file.fsPath}`);
        }

        // Priority: git dirty (uncommitted) > git committed > filesystem
        let modifiedTime: number | undefined;
        let createdTime: number | undefined;
        if (isDirty) {
          modifiedTime = filesystemModifiedTime;
          createdTime = gitMetadata?.createdTime ?? filesystemCreatedTime;
        } else if (gitMetadata) {
          modifiedTime = gitMetadata.modifiedTime ?? filesystemModifiedTime;
          createdTime = gitMetadata.createdTime ?? filesystemCreatedTime;
        } else {
          modifiedTime = filesystemModifiedTime;
          createdTime = filesystemCreatedTime;
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
      await vscode.window.showTextDocument(doc, this.tabGroupResolver.findTargetColumn());
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open shader: ${error}`,
      );
    }
  }

  private async activateShader(shaderPath: string): Promise<void> {
    try {
      const hasActiveViewer = await vscode.commands.executeCommand<boolean>(
        "shader-studio.hasActiveViewer",
      );

      if (!hasActiveViewer) {
        await vscode.commands.executeCommand("shader-studio.view");
      }

      await vscode.commands.executeCommand(
        "shader-studio.refreshSpecificShaderByPath",
        shaderPath,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to activate shader: ${error}`,
      );
    }
  }

  private async openConfig(configPath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc, this.tabGroupResolver.findTargetColumn());
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
        
    if (cspMatch) {
      // Update existing CSP to include webview.cspSource
      const existingCsp = cspMatch[1];
            
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
                    
          return finalHtml;
        }
      }
            
      // Fallback: return original HTML if CSP injection fails
      return processedHtml;
    }
  }
}

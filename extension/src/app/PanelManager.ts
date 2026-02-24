import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProvider } from "./ShaderProvider";
import { Messenger } from "./transport/Messenger";
import { WebviewTransport } from "./transport/WebviewTransport";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";
import { OverlayPanelHandler } from "./OverlayPanelHandler";
import { WorkspaceFileScanner } from "./WorkspaceFileScanner";
import type { ShaderConfig, ErrorMessage } from "@shader-studio/types";

export class PanelManager {
  private panels: Set<vscode.WebviewPanel> = new Set();
  private logger!: Logger;
  private webviewTransport: WebviewTransport;
  private overlayHandler: OverlayPanelHandler;

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProvider: ShaderProvider,
    private glslFileTracker: GlslFileTracker,
  ) {
    this.logger = Logger.getInstance();
    this.webviewTransport = new WebviewTransport();
    this.overlayHandler = new OverlayPanelHandler();
    this.messenger.addTransport(this.webviewTransport);
  }

  public getPanel(): vscode.WebviewPanel | undefined {
    return this.panels.values().next().value;
  }

  public getPanels(): vscode.WebviewPanel[] {
    return Array.from(this.panels);
  }

  public createPanel(): void {
    const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();

    const layout = vscode.window.tabGroups.all;
    const emptyGroup = layout.find((group) => group.tabs.length === 0);

    if (emptyGroup) {
      this.createWebviewPanelInColumn(editor, emptyGroup.viewColumn);
    } else {
      this.createWebviewPanel(editor);
    }
  }

  public async createPanelInNewWindow(): Promise<void> {
    this.createPanel();
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
  }

  private createWebviewPanel(editor: vscode.TextEditor | null): void {
    this.createWebviewPanelInColumn(editor, vscode.ViewColumn.Beside);
  }

  private createWebviewPanelInColumn(
    editor: vscode.TextEditor | null,
    viewColumn: vscode.ViewColumn,
  ): void {
    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];
    const shaderDir = editor
      ? vscode.Uri.file(path.dirname(editor.document.uri.fsPath))
      : (workspaceFolders[0] ?? vscode.Uri.file(this.context.extensionPath));

    const panel = vscode.window.createWebviewPanel(
      "shader-studio",
      "Shader Studio",
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(
            path.join(this.context.extensionPath, "ui-dist"),
          ),
          shaderDir,
          ...workspaceFolders,
        ],
      },
    );

    this.panels.add(panel);

    // Add panel to the shared webview transport
    this.webviewTransport.addPanel(panel);

    this.setupWebviewHtml(panel);

    if (editor) {
      setTimeout(
        () => this.shaderProvider.sendShaderToWebview(editor),
        200,
      );
    }

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        await this.handleWebviewMessage(message, panel);
      } catch (error) {
        console.error('PanelManager: Unhandled error in webview message handler:', error);
      }
    });

    panel.onDidDispose(() => {
      this.webviewTransport.removePanel(panel);
      this.panels.delete(panel);
    });

    this.logger.info("Webview panel created");
  }

  private async handleWebviewMessage(message: any, panel: vscode.WebviewPanel): Promise<void> {
    this.logger.debug(`Webview message received: ${message.type}`);
    if (message.type === 'updateConfig') {
      await this.handleConfigUpdate(message.payload);
    } else if (message.type === 'createBufferFile') {
      await this.handleCreateBufferFile(message.payload);
    } else if (message.type === 'updateShaderSource') {
      await this.overlayHandler.handleUpdateShaderSource(message.payload);
    } else if (message.type === 'requestFileContents') {
      await this.overlayHandler.handleRequestFileContents(message.payload, panel);
    } else if (message.type === 'navigateToBuffer') {
      await this.handleNavigateToBuffer(message.payload, panel);
    } else if (message.type === 'requestWorkspaceFiles') {
      console.log('PanelManager: Received requestWorkspaceFiles message', message.payload);
      await this.handleRequestWorkspaceFiles(message.payload, panel);
    } else if (message.type === 'forkShader') {
      await this.handleForkShader(message.payload, panel);
    }
  }

  private async handleConfigUpdate(payload: { config: ShaderConfig; text: string; shaderPath?: string }): Promise<void> {
    try {
      // Use the shader path from the payload (ensures locked shader writes to correct file)
      // Fall back to active/last viewed editor
      let shaderPath = payload.shaderPath;
      if (!shaderPath) {
        const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
        if (!editor) {
          this.logger.warn("No active shader to update config for");
          return;
        }
        shaderPath = editor.document.uri.fsPath;
      }

      const configPath = shaderPath.replace(/\.(glsl|frag)$/, '.sha.json');

      // Write the config to file
      fs.writeFileSync(configPath, payload.text, 'utf-8');
      this.logger.info(`Config updated: ${configPath}`);

      // Trigger shader refresh
      setTimeout(() => {
        this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
      }, 150);
    } catch (error) {
      this.logger.error(`Failed to update config: ${error}`);
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to update shader config: ${error}`] };
      this.messenger.send(errorMsg);
    }
  }

  private async handleCreateBufferFile(payload: { bufferName: string; filePath: string }): Promise<void> {
    try {
      const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
      if (!editor) {
        this.logger.warn("No active shader to create buffer file for");
        return;
      }

      const shaderPath = editor.document.uri.fsPath;
      const shaderDir = path.dirname(shaderPath);
      const bufferFilePath = path.join(shaderDir, payload.filePath);

      // Only create if file doesn't exist
      if (!fs.existsSync(bufferFilePath)) {
        let template: string;
        if (payload.bufferName === 'common') {
          template = `// Common functions shared across all passes\n`;
        } else {
          template = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = vec4(uv, 0.0, 1.0);\n}\n`;
        }
        fs.writeFileSync(bufferFilePath, template, 'utf-8');
        this.logger.info(`Created buffer file: ${bufferFilePath}`);
      } else {
        this.logger.info(`Buffer file already exists: ${bufferFilePath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create buffer file: ${error}`);
    }
  }

  private async handleNavigateToBuffer(
    payload: { bufferPath: string; shaderPath: string },
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('shader-studio').get('navigateOnBufferSwitch', true);
    if (!enabled) return;

    if (!payload.bufferPath || !fs.existsSync(payload.bufferPath)) return;

    const viewColumn = this.resolveTargetColumn(panel, payload.shaderPath);
    const uri = vscode.Uri.file(payload.bufferPath);
    await vscode.window.showTextDocument(uri, { viewColumn, preview: false, preserveFocus: true });
  }

  private resolveTargetColumn(panel: vscode.WebviewPanel, shaderPath: string): vscode.ViewColumn {
    // Collect all webview panel columns to avoid
    const panelColumns = new Set<vscode.ViewColumn>();
    for (const p of this.panels) {
      if (p.viewColumn !== undefined) {
        panelColumns.add(p.viewColumn);
      }
    }

    const tabGroups = vscode.window.tabGroups.all;

    // Find the group containing the locked shader file
    for (const group of tabGroups) {
      if (panelColumns.has(group.viewColumn)) continue;
      for (const tab of group.tabs) {
        if (tab.input && typeof tab.input === 'object' && 'uri' in tab.input) {
          const tabUri = (tab.input as { uri: vscode.Uri }).uri;
          if (tabUri.fsPath === shaderPath) {
            return group.viewColumn;
          }
        }
      }
    }

    // Fall back to left-most non-panel group
    for (const group of tabGroups) {
      if (!panelColumns.has(group.viewColumn)) {
        return group.viewColumn;
      }
    }

    return vscode.ViewColumn.One;
  }

  private async handleRequestWorkspaceFiles(
    payload: { extensions: string[]; shaderPath: string },
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    try {
      console.log('PanelManager: Scanning workspace files for extensions:', payload.extensions);
      const files = await WorkspaceFileScanner.scanFiles(
        payload.extensions,
        payload.shaderPath,
        panel.webview,
      );
      console.log(`PanelManager: Found ${files.length} workspace files`);
      const response = {
        type: "workspaceFiles",
        payload: { files },
      };
      panel.webview.postMessage(response);
    } catch (error) {
      console.error(`PanelManager: Failed to scan workspace files:`, error);
      this.logger.error(`Failed to scan workspace files: ${error}`);
      const response = {
        type: "workspaceFiles",
        payload: { files: [] },
      };
      panel.webview.postMessage(response);
    }
  }

  private async handleForkShader(
    payload: { shaderPath: string },
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    try {
      const sourcePath = payload.shaderPath;
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        this.logger.warn("No shader path to fork");
        return;
      }

      const sourceDir = path.dirname(sourcePath);
      const sourceExt = path.extname(sourcePath);
      // Strip any existing numeric suffix (e.g. "shader.2" → "shader")
      const rawBase = path.basename(sourcePath, sourceExt);
      const rootBase = rawBase.replace(/\.\d+$/, '');

      // Find next available integer suffix
      let counter = 1;
      while (fs.existsSync(path.join(sourceDir, `${rootBase}.${counter}${sourceExt}`))) {
        counter++;
      }

      const result = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(sourceDir, `${rootBase}.${counter}${sourceExt}`)),
        filters: { 'GLSL Shader': ['glsl'] },
      });

      if (!result) {
        return;
      }

      const destPath = result.fsPath;

      // Copy the .glsl file
      fs.copyFileSync(sourcePath, destPath);
      this.logger.info(`Forked shader: ${sourcePath} → ${destPath}`);

      // Copy .sha.json if it exists
      const sourceConfigPath = sourcePath.replace(/\.(glsl|frag)$/, '.sha.json');
      if (fs.existsSync(sourceConfigPath)) {
        const destConfigPath = destPath.replace(/\.(glsl|frag)$/, '.sha.json');
        fs.copyFileSync(sourceConfigPath, destConfigPath);
        this.logger.info(`Forked config: ${sourceConfigPath} → ${destConfigPath}`);
      }

      // Open the new file
      const doc = await vscode.workspace.openTextDocument(result);
      const viewColumn = this.resolveTargetColumn(panel, sourcePath);
      await vscode.window.showTextDocument(doc, { viewColumn, preview: false });
    } catch (error) {
      this.logger.error(`Failed to fork shader: ${error}`);
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to fork shader: ${error}`] };
      this.messenger.send(errorMsg);
    }
  }

  private setupWebviewHtml(panel: vscode.WebviewPanel): void {
    const htmlPath = path.join(
      this.context.extensionPath,
      "ui-dist",
      "index.html",
    );
    const rawHtml = fs.readFileSync(htmlPath, "utf-8");

    let processedHtml = rawHtml;

    // Convert relative resource URLs to webview URIs
    processedHtml = processedHtml.replace(
      /(src|href)="\.?\/([^"]+)"/g,
      (_, attr, file) => {
        const filePath = path.join(
          this.context.extensionPath,
          "ui-dist",
          file,
        );
        const uri = panel.webview.asWebviewUri(vscode.Uri.file(filePath));
        this.logger.debug(`Mapped ${file} to ${uri.toString()}`);
        return `${attr}="${uri}"`;
      },
    );

    // Inject or update CSP to allow video loading from webview sources
    const cspPattern = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']+)["'][^>]*>/i;
    const cspMatch = processedHtml.match(cspPattern);
    
    if (cspMatch) {
      // Update existing CSP to include media-src
      const existingCsp = cspMatch[1];
      
      // Use the actual webview.cspSource which should include the CDN domain
      const mediaSrc = `media-src ${panel.webview.cspSource} blob:`;
      const workerSrc = `worker-src ${panel.webview.cspSource} blob:`;
      let updatedCsp = existingCsp.includes('media-src')
        ? existingCsp.replace(/media-src[^;]*/, mediaSrc)
        : `${existingCsp}; ${mediaSrc}`;
      updatedCsp = updatedCsp.includes('worker-src')
        ? updatedCsp.replace(/worker-src[^;]*/, workerSrc)
        : `${updatedCsp}; ${workerSrc}`;
      
      processedHtml = processedHtml.replace(
        cspPattern,
        `<meta http-equiv="Content-Security-Policy" content="${updatedCsp}">`
      );
      this.logger.debug(`Updated CSP to: ${updatedCsp}`);
      this.logger.debug("Updated existing CSP for video support");
    } else {
      // Add CSP inside <head> tag properly - use nonce-based approach like working example
      const nonce = 'abc123'; // In production, generate a random nonce
      const newCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; media-src ${panel.webview.cspSource} blob:; worker-src ${panel.webview.cspSource} blob:; font-src ${panel.webview.cspSource};">`;
      
      // Handle both <!doctype html> and <html> cases
      const doctypeMatch = processedHtml.match(/<!doctype html>/i);
      const htmlMatch = processedHtml.match(/<html[^>]*>/i);
      
      if (doctypeMatch && htmlMatch) {
        // Insert after <html> tag but before </head>
        const headMatch = processedHtml.match(/<head[^>]*>/i);
        if (headMatch) {
          const headIndex = processedHtml.indexOf(headMatch[0]);
          const afterHeadIndex = headIndex + headMatch[0].length;
          
          processedHtml = processedHtml.slice(0, afterHeadIndex) + 
                         `\n    ${newCsp}` + 
                         processedHtml.slice(afterHeadIndex);
          
          this.logger.debug(`Added nonce-based CSP after <head> tag`);
        } else {
          // No head tag found, add it
          const afterHtmlIndex = processedHtml.indexOf(htmlMatch[0]) + htmlMatch[0].length;
          processedHtml = processedHtml.slice(0, afterHtmlIndex) + 
                         `\n  <head>\n    ${newCsp}\n  </head>` + 
                         processedHtml.slice(afterHtmlIndex);
          this.logger.debug(`Added nonce-based CSP with new <head> tag`);
        }
      } else {
        // Fallback: just prepend
        processedHtml = `<head>${newCsp}</head>\n` + processedHtml;
        this.logger.debug(`Added nonce-based CSP at document start as fallback`);
      }
    }

    panel.webview.html = processedHtml;
    this.logger.debug("Webview HTML set with resource URIs and video CSP");
  }

  public dispose(): void {
    this.panels.forEach(panel => panel.dispose());
    this.panels.clear();
    this.messenger.removeTransport(this.webviewTransport);
  }
}

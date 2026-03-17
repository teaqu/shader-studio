import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProvider } from "./ShaderProvider";
import { Messenger } from "./transport/Messenger";
import { WebviewTransport } from "./transport/WebviewTransport";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";
import { OverlayPanelHandler } from "./OverlayPanelHandler";
import { WorkspaceFileScanner } from "./WorkspaceFileScanner";
import { VideoAudioConverter } from "./services/VideoAudioConverter";
import { writeWorkspaceTypeDefs } from "./WorkspaceTypeDefs";
import type { ShaderConfig, ErrorMessage } from "@shader-studio/types";

export class PanelManager {
  private panels: Set<vscode.WebviewPanel> = new Set();
  private logger!: Logger;
  private webviewTransport: WebviewTransport;
  private overlayHandler: OverlayPanelHandler;
  private videoAudioConverter: VideoAudioConverter;

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProvider: ShaderProvider,
    private glslFileTracker: GlslFileTracker,
  ) {
    this.logger = Logger.getInstance();
    this.videoAudioConverter = new VideoAudioConverter();
    this.webviewTransport = new WebviewTransport();
    this.overlayHandler = new OverlayPanelHandler();
    this.webviewTransport.setVideoAudioConverter(this.videoAudioConverter);
    this.webviewTransport.setOnVideoConverted((originalConfigPath, convertedAbsolutePath) => {
      this.handleVideoAudioConverted(originalConfigPath, convertedAbsolutePath);
    });
    this.messenger.addTransport(this.webviewTransport);
  }

  public createPanel(): void {
    const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
    const lockGroup = vscode.workspace.getConfiguration('shader-studio').get<boolean>('lockEditorGroup', true);

    // Reuse an empty group if one exists (e.g. a previously locked group whose panel was closed)
    const layout = vscode.window.tabGroups.all;
    const emptyGroup = layout.find((group) => group.tabs.length === 0);
    if (emptyGroup) {
      this.createWebviewPanelInColumn(editor, emptyGroup.viewColumn);
    } else if (lockGroup) {
      this.createWebviewPanelInColumn(editor, vscode.ViewColumn.Beside);
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

    const lockGroup = vscode.workspace.getConfiguration('shader-studio').get<boolean>('lockEditorGroup', true);
    if (lockGroup) {
      this.lockPanelEditorGroup(panel);
    }
  }

  private async lockPanelEditorGroup(panel: vscode.WebviewPanel): Promise<void> {
    // Wait for the panel to settle in its editor group, then reveal to ensure focus
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      panel.reveal(panel.viewColumn, false);
      await new Promise(resolve => setTimeout(resolve, 200));
      await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
      this.logger.info("Editor group locked for shader panel");
    } catch (e) {
      this.logger.error(`Failed to lock editor group: ${e}`);
    }
  }

  private async handleWebviewMessage(message: any, panel: vscode.WebviewPanel): Promise<void> {
    this.logger.debug(`Webview message received: ${message.type}`);
    if (message.type === 'updateConfig') {
      await this.handleConfigUpdate(message.payload);
    } else if (message.type === 'createBufferFile') {
      await this.handleCreateBufferFile(message.payload);
    } else if (message.type === 'createScriptFile') {
      await this.handleCreateScriptFile(message.payload, panel);
    } else if (message.type === 'selectScriptFile') {
      await this.handleSelectScriptFile(message.payload, panel);
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
    } else if (message.type === 'saveFile') {
      await this.handleSaveFile(message.payload, panel);
    } else if (message.type === 'goToLine') {
      await this.handleGoToLine(message.payload);
    } else if (message.type === 'extensionCommand') {
      const cmd = message.payload?.command;
      if (cmd === 'moveToNewWindow') {
        panel.reveal();
        await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
        // Notify webview it's now in a separate window (delay for webview to settle)
        setTimeout(() => {
          panel.webview.postMessage({ type: 'panelState', payload: { isInWindow: true } });
        }, 500);
      } else if (cmd) {
        await vscode.commands.executeCommand(`shader-studio.${cmd}`);
      }
    } else if (message.type === 'updateScriptPollingRate') {
      const fps = message.payload?.fps;
      if (typeof fps === 'number' && fps > 0) {
        this.shaderProvider.updateScriptPollingRate(fps);
      }
    } else if (message.type === 'resetScriptTime') {
      this.shaderProvider.resetScriptTime();
    } else if (message.type === 'saveLayout') {
      console.log('[PanelManager] saveLayout received, payload:', message.payload ? 'present' : 'null');
      await this.context.workspaceState.update('shader-studio.dockviewLayout', message.payload);
      console.log('[PanelManager] saveLayout persisted to workspaceState');
    } else if (message.type === 'requestLayout') {
      const layout = this.context.workspaceState.get('shader-studio.dockviewLayout', null);
      console.log('[PanelManager] requestLayout received, saved layout:', layout ? 'found' : 'null');
      panel.webview.postMessage({ type: 'restoreLayout', payload: layout });
      console.log('[PanelManager] restoreLayout sent to webview');
    }
  }

  private async handleConfigUpdate(payload: { config: ShaderConfig; text: string; shaderPath?: string; skipRefresh?: boolean }): Promise<void> {
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

      // Skip shader refresh for resolution-only changes
      if (payload.skipRefresh) {
        return;
      }

      // Trigger shader refresh
      setTimeout(() => {
        if (typeof (this.shaderProvider as any).sendShaderFromPath === "function") {
          this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
          return;
        }
        this.logger.warn("ShaderProvider missing sendShaderFromPath during config refresh");
      }, 150);
    } catch (error) {
      this.logger.error(`Failed to update config: ${error}`);
      const errorMsg: ErrorMessage = { type: "error", payload: [`Failed to update shader config: ${error}`] };
      this.messenger.send(errorMsg);
    }
  }

  /**
   * After video audio conversion, update the .sha.json config to point to the new file and refresh.
   */
  private handleVideoAudioConverted(originalConfigPath: string, convertedAbsolutePath: string): void {
    try {
      // Find the active shader's .sha.json
      const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
      if (!editor) {
        this.logger.warn("No active shader for auto-swap after video conversion");
        return;
      }

      const shaderPath = editor.document.uri.fsPath;
      const configPath = shaderPath.replace(/\.(glsl|frag)$/, '.sha.json');

      if (!fs.existsSync(configPath)) {
        this.logger.warn(`Config file not found for auto-swap: ${configPath}`);
        return;
      }

      const configText = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configText) as ShaderConfig;
      const configDir = path.dirname(configPath);

      // Compute the relative path for the converted file, matching the style of the original
      const convertedRelative = path.relative(configDir, convertedAbsolutePath);

      let modified = false;

      // Walk all passes and inputs, replacing matching paths
      for (const passName of Object.keys(config.passes || {})) {
        const pass = config.passes[passName as keyof typeof config.passes];
        if (pass && typeof pass === 'object' && 'inputs' in pass && pass.inputs) {
          for (const key of Object.keys(pass.inputs)) {
            const input = pass.inputs[key as keyof typeof pass.inputs] as any;
            if (input?.path === originalConfigPath) {
              input.path = convertedRelative;
              modified = true;
            }
          }
        }
      }

      if (modified) {
        const updatedText = JSON.stringify(config, null, 2) + '\n';
        fs.writeFileSync(configPath, updatedText, 'utf-8');
        this.logger.info(`Auto-swapped video path in config: ${configPath}`);

        // Trigger shader refresh
        setTimeout(() => {
          this.shaderProvider.sendShaderFromPath(shaderPath, { forceCleanup: true });
        }, 150);
      }
    } catch (error) {
      this.logger.error(`Failed to auto-swap video path in config: ${error}`);
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

  private async handleCreateScriptFile(payload: { scriptPath: string; shaderPath: string }, panel: vscode.WebviewPanel): Promise<void> {
    try {
      const shaderDir = payload.shaderPath
        ? path.dirname(payload.shaderPath)
        : (() => {
            const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
            return editor ? path.dirname(editor.document.uri.fsPath) : null;
          })();

      if (!shaderDir) {
        this.logger.warn("No shader directory to create script file in");
        return;
      }

      // Derive default filename from shader name (e.g. myshader.uniforms.ts)
      const shaderBaseName = payload.shaderPath
        ? path.basename(payload.shaderPath).replace(/\.glsl$/, '')
        : 'uniforms';
      const defaultName = payload.scriptPath
        ? path.resolve(shaderDir, payload.scriptPath)
        : path.join(shaderDir, `${shaderBaseName}.uniforms.ts`);

      const result = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: { 'Script files': ['ts', 'js'] },
        title: 'Create Uniform Script',
      });
      if (!result) return;
      const scriptFilePath = result.fsPath;
      const relativePath = './' + path.relative(shaderDir, scriptFilePath).replace(/\\/g, '/');
      panel.webview.postMessage({ type: 'scriptFileCreated', payload: { scriptPath: relativePath } });

      if (!fs.existsSync(scriptFilePath)) {
        const isTs = scriptFilePath.endsWith('.ts');
        const template = isTs
          ? this.buildTsTemplate(scriptFilePath, shaderDir)
          : `export function uniforms(ctx) {\n  return {\n    // iDayOfWeek: new Date().getDay(),\n  };\n}\n`;
        fs.writeFileSync(scriptFilePath, template, 'utf-8');
        this.logger.info(`Created script file: ${scriptFilePath}`);
      } else {
        this.logger.info(`Script file already exists: ${scriptFilePath}`);
      }

      // Ensure workspace type defs are present when a .ts script is involved
      if (scriptFilePath.endsWith('.ts')) {
        writeWorkspaceTypeDefs(this.context.extensionPath, true);
      }
    } catch (error) {
      this.logger.error(`Failed to create script file: ${error}`);
    }
  }

  private async handleSelectScriptFile(payload: { shaderPath: string }, panel: vscode.WebviewPanel): Promise<void> {
    try {
      const shaderDir = payload.shaderPath
        ? path.dirname(payload.shaderPath)
        : (() => {
            const editor = this.glslFileTracker.getActiveOrLastViewedGLSLEditor();
            return editor ? path.dirname(editor.document.uri.fsPath) : null;
          })();

      const result = await vscode.window.showOpenDialog({
        defaultUri: shaderDir ? vscode.Uri.file(shaderDir) : undefined,
        filters: { 'Script files': ['ts', 'js'] },
        canSelectMany: false,
        title: 'Select Uniform Script',
      });
      if (!result || result.length === 0) return;

      const selectedPath = result[0].fsPath;
      const relativePath = shaderDir
        ? './' + path.relative(shaderDir, selectedPath).replace(/\\/g, '/')
        : selectedPath;
      panel.webview.postMessage({ type: 'scriptFileCreated', payload: { scriptPath: relativePath } });

      // Ensure workspace type defs are present/up to date for .ts scripts
      if (selectedPath.endsWith('.ts')) {
        writeWorkspaceTypeDefs(this.context.extensionPath, true);
      }
    } catch (error) {
      this.logger.error(`Failed to select script file: ${error}`);
    }
  }

  private buildTsTemplate(scriptFilePath: string, shaderDir: string): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let refLine = '';
    if (workspaceRoot) {
      const dtsPath = path.join(workspaceRoot, '.vscode', 'shader-studio.d.ts');
      const relToDts = path.relative(path.dirname(scriptFilePath), dtsPath).replace(/\\/g, '/');
      refLine = `/// <reference path="${relToDts}" />\n`;
    }
    const sep = refLine ? '\n' : '';
    return `${refLine}${sep}export function uniforms(ctx: UniformContext): Record<string, UniformValue> {\n  return {\n    // iDayOfWeek: new Date().getDay(),\n  };\n}\n`;
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
        (filePath) => ConfigPathConverter.convertUriForClient(filePath, panel.webview),
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

  private async handleSaveFile(
    payload: { data: string; defaultName: string; filters: Record<string, string[]> },
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    try {
      const filterEntries = Object.entries(payload.filters);
      const saveFilters: Record<string, string[]> = {};
      for (const [label, exts] of filterEntries) {
        saveFilters[label] = exts;
      }

      const result = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(payload.defaultName),
        filters: saveFilters,
      });

      if (!result) {
        panel.webview.postMessage({
          type: 'saveFileResult',
          payload: { success: false, error: 'Cancelled' },
        });
        return;
      }

      const buffer = Buffer.from(payload.data, 'base64');
      fs.writeFileSync(result.fsPath, buffer);

      panel.webview.postMessage({
        type: 'saveFileResult',
        payload: { success: true, path: result.fsPath },
      });

      this.logger.info(`File saved: ${result.fsPath}`);
    } catch (error) {
      panel.webview.postMessage({
        type: 'saveFileResult',
        payload: { success: false, error: String(error) },
      });
      this.logger.error(`Failed to save file: ${error}`);
    }
  }

  private async handleGoToLine(payload: { line: number; filePath: string }): Promise<void> {
    try {
      const { line, filePath } = payload;
      if (!filePath) return;

      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
      this.logger.error(`Failed to go to line: ${e}`);
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
      const connectSrc = `connect-src ${panel.webview.cspSource} blob:`;
      let updatedCsp = existingCsp.includes('media-src')
        ? existingCsp.replace(/media-src[^;]*/, mediaSrc)
        : `${existingCsp}; ${mediaSrc}`;
      updatedCsp = updatedCsp.includes('worker-src')
        ? updatedCsp.replace(/worker-src[^;]*/, workerSrc)
        : `${updatedCsp}; ${workerSrc}`;
      // Allow WASM compilation (needed for gifski-wasm GIF encoder)
      // and unsafe-eval (needed for custom uniform script evaluation via new Function())
      if (!updatedCsp.includes('wasm-unsafe-eval')) {
        updatedCsp = updatedCsp.replace(/script-src[^;]*/, (match) => `${match} 'wasm-unsafe-eval'`);
      }
      if (!updatedCsp.includes('unsafe-eval')) {
        updatedCsp = updatedCsp.replace(/script-src[^;]*/, (match) => `${match} 'unsafe-eval'`);
      }
      updatedCsp = updatedCsp.includes('connect-src')
        ? updatedCsp.replace(/connect-src[^;]*/, connectSrc)
        : `${updatedCsp}; ${connectSrc}`;
      
      processedHtml = processedHtml.replace(
        cspPattern,
        `<meta http-equiv="Content-Security-Policy" content="${updatedCsp}">`
      );
      this.logger.debug(`Updated CSP to: ${updatedCsp}`);
      this.logger.debug("Updated existing CSP for video support");
    } else {
      // Add CSP inside <head> tag properly - use nonce-based approach like working example
      const nonce = 'abc123'; // In production, generate a random nonce
      const newCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval' 'unsafe-eval'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; media-src ${panel.webview.cspSource} blob:; worker-src ${panel.webview.cspSource} blob:; connect-src ${panel.webview.cspSource} blob:; font-src ${panel.webview.cspSource};">`;
      
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

    // Inject @font-face overrides for fonts referenced by absolute paths in CSS.
    // CSS bundles use url(/assets/...) which doesn't resolve in webviews.
    const uiDistAssets = path.join(this.context.extensionPath, "ui-dist", "assets");
    if (fs.existsSync(uiDistAssets)) {
      const fontFiles = fs.readdirSync(uiDistAssets).filter(f => /\.(ttf|woff2?)$/.test(f));
      if (fontFiles.length > 0) {
        const fontFaces = fontFiles.map(f => {
          const fontUri = panel.webview.asWebviewUri(
            vscode.Uri.file(path.join(uiDistAssets, f))
          );
          const format = f.endsWith('.woff2') ? 'woff2' : f.endsWith('.woff') ? 'woff' : 'truetype';
          // Derive font family from filename (e.g. "codicon-DjkITdqj.ttf" → "codicon")
          const family = f.replace(/-[^.]+\.[^.]+$/, '');
          return `@font-face{font-family:"${family}";src:url("${fontUri}") format("${format}")}`;
        }).join('\n');
        const styleTag = `<style>${fontFaces}</style>`;
        // Insert before </head>
        processedHtml = processedHtml.replace('</head>', `${styleTag}\n</head>`);
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

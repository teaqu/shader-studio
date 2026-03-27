import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProvider } from "./ShaderProvider";
import { Messenger } from "./transport/Messenger";
import { WebviewTransport } from "./transport/WebviewTransport";
import { ConfigPathConverter } from "./transport/ConfigPathConverter";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";
import { VideoAudioConverter } from "./services/VideoAudioConverter";
import { ClientMessageHandler } from "./ClientMessageHandler";
import type { ShaderConfig } from "@shader-studio/types";

export class PanelManager {
  private panels: Set<vscode.WebviewPanel> = new Set();
  private panelSlots: Map<vscode.WebviewPanel, number> = new Map();
  private logger!: Logger;
  private webviewTransport: WebviewTransport;
  private videoAudioConverter: VideoAudioConverter;
  private clientHandler: ClientMessageHandler;

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProvider: ShaderProvider,
    private glslFileTracker: GlslFileTracker,
  ) {
    this.logger = Logger.getInstance();
    this.videoAudioConverter = new VideoAudioConverter();
    this.webviewTransport = new WebviewTransport();
    this.webviewTransport.setVideoAudioConverter(this.videoAudioConverter);
    this.webviewTransport.setOnVideoConverted((originalConfigPath, convertedAbsolutePath) => {
      this.handleVideoAudioConverted(originalConfigPath, convertedAbsolutePath);
    });
    this.messenger.addTransport(this.webviewTransport);

    this.clientHandler = new ClientMessageHandler(
      context,
      shaderProvider,
      glslFileTracker,
      messenger,
      context.extensionPath,
      () => {
        const cols = new Set<vscode.ViewColumn>();
        for (const p of this.panels) {
          if (p.viewColumn !== undefined) {
            cols.add(p.viewColumn); 
          }
        }
        return cols;
      },
    );
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

  public toggleEditorOverlayInActivePanel(): void {
    this.postMessageToActivePanel({ type: "toggleEditorOverlay" }, "editor overlay toggle");
  }

  private postMessageToActivePanel(message: unknown, actionName: string): void {
    const activePanel =
      Array.from(this.panels).find((panel) => panel.active) ??
      Array.from(this.panels).find((panel) => panel.visible);

    if (!activePanel) {
      this.logger.debug(`No active shader panel available for ${actionName}`);
      return;
    }

    activePanel.webview.postMessage(message);
  }

  private createWebviewPanel(editor: vscode.TextEditor | null): void {
    this.createWebviewPanelInColumn(editor, vscode.ViewColumn.Beside);
  }

  private createWebviewPanelInColumn(
    editor: vscode.TextEditor | null,
    viewColumn: vscode.ViewColumn,
  ): void {
    const layoutSlot = this.allocateLayoutSlot();
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
    this.panelSlots.set(panel, layoutSlot);

    // Add panel to the shared webview transport
    this.webviewTransport.addPanel(panel);

    this.setupWebviewHtml(panel, layoutSlot);

    if (editor) {
      void this.shaderProvider.sendShaderToWebview(editor);
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
      this.panelSlots.delete(panel);
    });

    this.logger.info("Webview panel created");

    const lockGroup = vscode.workspace.getConfiguration('shader-studio').get<boolean>('lockEditorGroup', true);
    if (lockGroup) {
      this.lockPanelEditorGroup(panel);
    }
  }

  private allocateLayoutSlot(): number {
    let slot = 1;
    const usedSlots = new Set(this.panelSlots.values());
    while (usedSlots.has(slot)) {
      slot++;
    }
    return slot;
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

    // Handle moveToNewWindow directly — it needs the panel reference and is not shared
    if (message.type === 'extensionCommand' && message.payload?.command === 'moveToNewWindow') {
      panel.reveal();
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
      // Notify webview it's now in a separate window (delay for webview to settle)
      setTimeout(() => {
        panel.webview.postMessage({ type: 'panelState', payload: { isInWindow: true } });
      }, 500);
      return;
    }

    await this.clientHandler.handle(
      message,
      (msg) => panel.webview.postMessage(msg),
      (absPath) => ConfigPathConverter.convertUriForClient(absPath, panel.webview),
    );
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

  private setupWebviewHtml(panel: vscode.WebviewPanel, layoutSlot: number): void {
    const htmlPath = path.join(
      this.context.extensionPath,
      "ui-dist",
      "index.html",
    );
    const rawHtml = fs.readFileSync(htmlPath, "utf-8");

    let processedHtml = rawHtml;

    const layoutMeta = `<meta name="shader-studio-layout-slot" content="vscode:${layoutSlot}"><meta name="shader-studio-host-type" content="vscode">`;
    processedHtml = processedHtml.replace(/<head([^>]*)>/i, `<head$1>${layoutMeta}`);

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

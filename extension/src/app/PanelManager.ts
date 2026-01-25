import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProvider } from "./ShaderProvider";
import { Messenger } from "./transport/Messenger";
import { WebviewTransport } from "./transport/WebviewTransport";
import { Logger } from "./services/Logger";
import { GlslFileTracker } from "./GlslFileTracker";

export class PanelManager {
  private panels: Set<vscode.WebviewPanel> = new Set();
  private logger!: Logger;
  private webviewTransport: WebviewTransport;

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProvider: ShaderProvider,
    private glslFileTracker: GlslFileTracker,
  ) {
    this.logger = Logger.getInstance();
    this.webviewTransport = new WebviewTransport();
    this.messenger.addTransport(this.webviewTransport);
  }

  public getPanel(): vscode.WebviewPanel | undefined {
    return this.panels.values().next().value;
  }

  public getPanels(): vscode.WebviewPanel[] {
    return Array.from(this.panels);
  }

  private createWebviewPanel(editor: vscode.TextEditor | null): void {
    this.createWebviewPanelInColumn(editor, vscode.ViewColumn.Beside);
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

    panel.onDidDispose(() => {
      this.webviewTransport.removePanel(panel);
      this.panels.delete(panel);
    });

    this.logger.info("Webview panel created");
  }

  private setupWebviewHtml(panel: vscode.WebviewPanel): void {
    console.log('PanelManager: setupWebviewHtml called');
    
    const htmlPath = path.join(
      this.context.extensionPath,
      "ui-dist",
      "index.html",
    );
    const rawHtml = fs.readFileSync(htmlPath, "utf-8");

    console.log(`PanelManager: Read HTML from ${htmlPath}`);
    console.log(`PanelManager: First 200 chars of HTML: ${rawHtml.substring(0, 200)}`);

    // Convert relative resource URLs to webview URIs
    let processedHtml = rawHtml.replace(
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
    
    console.log(`PanelManager: Webview CSP source: ${panel.webview.cspSource}`);
    
    if (cspMatch) {
      // Update existing CSP to include media-src
      const existingCsp = cspMatch[1];
      console.log(`PanelManager: Found existing CSP: ${existingCsp}`);
      
      // Use the actual webview.cspSource which should include the CDN domain
      const mediaSrc = `media-src ${panel.webview.cspSource} blob:`;
      const updatedCsp = existingCsp.includes('media-src') 
        ? existingCsp.replace(/media-src[^;]*/, mediaSrc)
        : `${existingCsp}; ${mediaSrc}`;
      
      processedHtml = processedHtml.replace(
        cspPattern,
        `<meta http-equiv="Content-Security-Policy" content="${updatedCsp}">`
      );
      console.log(`PanelManager: Updated CSP to: ${updatedCsp}`);
      this.logger.debug("Updated existing CSP for video support");
    } else {
      // Add CSP inside <head> tag properly - use nonce-based approach like working example
      const nonce = 'abc123'; // In production, generate a random nonce
      const newCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; media-src ${panel.webview.cspSource} blob:; font-src ${panel.webview.cspSource};">`;
      
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
          
          console.log(`PanelManager: Added nonce-based CSP after <head> tag`);
        } else {
          // No head tag found, add it
          const afterHtmlIndex = processedHtml.indexOf(htmlMatch[0]) + htmlMatch[0].length;
          processedHtml = processedHtml.slice(0, afterHtmlIndex) + 
                         `\n  <head>\n    ${newCsp}\n  </head>` + 
                         processedHtml.slice(afterHtmlIndex);
          console.log(`PanelManager: Added nonce-based CSP with new <head> tag`);
        }
      } else {
        // Fallback: just prepend
        processedHtml = `<head>${newCsp}</head>\n` + processedHtml;
        console.log(`PanelManager: Added nonce-based CSP at document start as fallback`);
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

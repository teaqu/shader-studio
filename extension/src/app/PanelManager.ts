import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProcessor } from "./ShaderProcessor";
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
    private shaderProcessor: ShaderProcessor,
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
      "Shadera",
      "Shadera",
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
        () => this.shaderProcessor.sendShaderToWebview(editor),
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
    const htmlPath = path.join(
      this.context.extensionPath,
      "ui-dist",
      "index.html",
    );
    const rawHtml = fs.readFileSync(htmlPath, "utf-8");

    panel.webview.html = rawHtml.replace(
      /(src|href)="(.+?)"/g,
      (_, attr, file) => {
        const cleaned = file.replace(/^\\|^\//, "");
        const filePath = path.join(
          this.context.extensionPath,
          "ui-dist",
          cleaned,
        );
        const uri = panel.webview.asWebviewUri(vscode.Uri.file(filePath));
        return `${attr}="${uri}"`;
      },
    );
    this.logger.debug("Webview HTML set");
  }
}

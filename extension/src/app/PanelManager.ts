import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProcessor } from "./ShaderProcessor";
import { Messenger } from "./communication/Messenger";
import { WebviewTransport } from "./communication/WebviewTransport";
import { Logger } from "./services/Logger";
import { ShaderUtils } from "./util/ShaderUtils";

export class PanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private logger!: Logger; // Initialize when accessed

  constructor(
    private context: vscode.ExtensionContext,
    private messenger: Messenger,
    private shaderProcessor: ShaderProcessor,
  ) {
    this.logger = Logger.getInstance();
  }

  public getPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  private createWebviewPanel(editor: vscode.TextEditor): void {
    this.createWebviewPanelInColumn(editor, vscode.ViewColumn.Beside);
  }

  public createShaderView(): void {
    const editor = ShaderUtils.getActiveGLSLEditor() ??
      vscode.window.visibleTextEditors.find((e) =>
        e.document.languageId === "glsl" ||
        e.document.fileName.endsWith(".glsl")
      );
    if (!editor) {
      vscode.window.showErrorMessage("No active GLSL file selected");
      return;
    }

    const layout = vscode.window.tabGroups.all;
    const emptyGroup = layout.find(group => group.tabs.length === 0);

    if (emptyGroup) {
      this.createWebviewPanelInColumn(editor, emptyGroup.viewColumn);
    } else {
      this.createWebviewPanel(editor);
    }
  }

  private createWebviewPanelInColumn(editor: vscode.TextEditor, viewColumn: vscode.ViewColumn): void {
    if (this.panel) {
      this.panel.reveal(viewColumn);
      this.shaderProcessor.sendShaderToWebview(editor);
      return;
    }

    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];
    const shaderDir = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));

    this.panel = vscode.window.createWebviewPanel(
      "shaderView",
      "Shader View",
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(
            path.join(this.context.extensionPath, "../ui", "dist"),
          ),
          shaderDir,
          ...workspaceFolders,
        ],
      },
    );

    // Add webview transport to the shared message transporter
    const webviewTransport = new WebviewTransport(this.panel);
    this.messenger.addTransport(webviewTransport);

    this.setupWebviewHtml();

    setTimeout(
      () => this.shaderProcessor.sendShaderToWebview(editor),
      200,
    );

    this.panel.onDidDispose(() => {
      this.messenger.removeTransport(webviewTransport);
      this.panel = undefined;
    });

    this.logger.info("Webview panel created");
  }

  private setupWebviewHtml(): void {
    if (!this.panel) {
      return;
    }

    const htmlPath = path.join(
      this.context.extensionPath,
      "../ui",
      "dist",
      "index.html",
    );
    const rawHtml = fs.readFileSync(htmlPath, "utf-8");

    this.panel.webview.html = rawHtml.replace(
      /(src|href)="(.+?)"/g,
      (_, attr, file) => {
        const cleaned = file.replace(/^\\|^\//, "");
        const filePath = path.join(
          this.context.extensionPath,
          "../ui",
          "dist",
          cleaned,
        );
        const uri = this.panel!.webview.asWebviewUri(vscode.Uri.file(filePath));
        return `${attr}="${uri}"`;
      },
    );
    this.logger.debug("Webview HTML set");
  }
}

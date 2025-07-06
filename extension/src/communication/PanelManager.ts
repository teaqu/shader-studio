import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProcessor } from "../ShaderProcessor";
import { MessageSender } from "./MessageSender";

export class PanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private messenger: MessageSender | undefined;
  private shaderProcessor: ShaderProcessor;

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.shaderProcessor = new ShaderProcessor(outputChannel);
  }

  public getPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  public createWebviewPanel(editor: vscode.TextEditor): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.shaderProcessor.sendShaderToWebview(editor, this.messenger!);
      return;
    }

    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];
    const shaderDir = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));

    this.panel = vscode.window.createWebviewPanel(
      "shaderToy",
      "ShaderToy",
      vscode.ViewColumn.Beside,
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

    // Create messenger with the panel and message handler
    this.messenger = new MessageSender(
      this.outputChannel,
      this.diagnosticCollection,
      this.panel
    );

    this.setupWebviewHtml();

    // Send shader on first load
    setTimeout(
      () => this.shaderProcessor.sendShaderToWebview(editor, this.messenger!),
      200,
    );

    // Dispose handler
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.messenger = undefined;
    });

    this.outputChannel.info("Webview panel created");
  }

  public sendShaderToWebview(editor: vscode.TextEditor, isLocked: boolean = false): void {
    if (this.messenger) {
      this.shaderProcessor.sendShaderToWebview(editor, this.messenger, isLocked);
    }
  }

  private setupWebviewHtml(): void {
    if (!this.panel) return;

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
    this.outputChannel.debug("Webview HTML set");
  }
}

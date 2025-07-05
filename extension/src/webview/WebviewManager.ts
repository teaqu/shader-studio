import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ShaderProcessor } from "../shader/ShaderProcessor";

export class WebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private shaderProcessor: ShaderProcessor;
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.shaderProcessor = new ShaderProcessor(outputChannel);
    this.diagnosticCollection = diagnosticCollection;
  }

  public getPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  public createWebviewPanel(editor: vscode.TextEditor): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.shaderProcessor.sendShaderToWebview(editor, this.panel);
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

    this.setupMessageHandling();
    this.setupWebviewHtml();

    // Send shader on first load
    setTimeout(
      () => this.shaderProcessor.sendShaderToWebview(editor, this.panel!),
      200,
    );

    // Dispose handler
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.outputChannel.info("Webview panel created");
  }

  public sendShaderToWebview(editor: vscode.TextEditor): void {
    if (this.panel) {
      this.shaderProcessor.sendShaderToWebview(editor, this.panel);
    }
  }

  private setupMessageHandling(): void {
    if (!this.panel) return;

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === "log") {
          const logText = message.payload.join
            ? message.payload.join(" ")
            : message.payload;
          this.outputChannel.info(logText);

          if (
            logText.includes("Shader compiled and linked") &&
            vscode.window.activeTextEditor?.document.languageId === "glsl"
          ) {
            this.diagnosticCollection.delete(
              vscode.window.activeTextEditor.document.uri,
            );
          }
        }

        if (message.type === "debug") {
          const debugText = message.payload.join
            ? message.payload.join(" ")
            : message.payload;
          this.outputChannel.debug(debugText);
        }

        if (message.type === "error") {
          let errorText = message.payload.join
            ? message.payload.join(" ")
            : message.payload;
          errorText = errorText.slice(0, -1);
          this.outputChannel.error(errorText);

          // Try to extract GLSL error line (e.g., ERROR: 0:29: ...)
          const match = errorText.match(/ERROR:\s*\d+:(\d+):/);
          const editor = vscode.window.activeTextEditor;
          if (match && editor && editor.document.languageId === "glsl") {
            const lineNum = parseInt(match[1], 10) - 1; // VS Code is 0-based
            const range = editor.document.lineAt(lineNum).range;

            // Set diagnostic
            const diagnostic = new vscode.Diagnostic(
              range,
              errorText,
              vscode.DiagnosticSeverity.Error,
            );
            this.diagnosticCollection.set(editor.document.uri, [diagnostic]);
          } else if (editor) {
            // Clear diagnostics if no error
            this.diagnosticCollection.delete(editor.document.uri);
          }
        }

        if (message.type === "toggleLock") {
          vscode.commands.executeCommand("shader-view.toggleLock");
        }
      },
      undefined,
      this.context.subscriptions,
    );
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

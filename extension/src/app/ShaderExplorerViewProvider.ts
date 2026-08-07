import * as vscode from "vscode";
import * as path from "path";
import { ShaderExplorerBackend } from "./ShaderExplorerBackend";

export class ShaderExplorerViewProvider implements vscode.WebviewViewProvider {
  private backend: ShaderExplorerBackend | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "shader-explorer-dist")),
        vscode.Uri.file(path.join(this.context.extensionPath, "ui-dist")),
        ...workspaceFolders,
      ],
    };

    this.backend = new ShaderExplorerBackend(this.context, webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.backend?.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.backend?.dispose();
      this.backend = undefined;
    });

    webviewView.webview.html = this.backend.getHtmlForWebview();
  }
}

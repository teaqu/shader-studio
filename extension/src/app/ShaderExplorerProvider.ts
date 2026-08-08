import * as vscode from "vscode";
import * as path from "path";
import { ShaderExplorerBackend } from "./ShaderExplorerBackend";
import { ShaderGitMetadataProvider } from "./ShaderGitMetadataProvider";

export class ShaderExplorerProvider {
  private panel: vscode.WebviewPanel | undefined;
  private backend: ShaderExplorerBackend | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private gitMetadataProvider?: Pick<ShaderGitMetadataProvider, "getMetadataForWorkspace" | "clearCache">,
  ) {}

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
      try {
        this.panel.reveal(vscode.ViewColumn.One);
        return;
      } catch {
        // Panel was disposed without onDidDispose firing (e.g. extension
        // host restart). Clean up and create a fresh one below.
        this.panel = undefined;
        this.backend?.dispose();
        this.backend = undefined;
      }
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
          vscode.Uri.file(
            path.join(this.context.extensionPath, "ui-dist"),
          ),
          ...workspaceFolders,
        ],
      },
    );

    this.backend = new ShaderExplorerBackend(
      this.context,
      this.panel.webview,
      this.gitMetadataProvider,
    );

    this.panel.onDidDispose(() => {
      this.backend?.dispose();
      this.backend = undefined;
      this.panel = undefined;
    });

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(async (message) => {
      await this.backend?.handleMessage(message);
    });

    this.panel.webview.html = this.backend.getHtmlForWebview();
  }
}

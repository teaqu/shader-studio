import * as vscode from "vscode";
import { ErrorMessage } from "@shader-studio/types";

export class ErrorHandler {
  private currentShaderConfig: { config: any; shaderPath: string } | null = null;
  
  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) {}

  public setShaderConfig(config: { config: any; shaderPath: string } | null): void {
    this.currentShaderConfig = config;
  }

  public handleError(message: ErrorMessage): void {
    let errorText = Array.isArray(message.payload)
      ? message.payload.join(" ")
      : message.payload;
    
    this.outputChannel.error(errorText);

    const match = errorText.match(/ERROR:\s*\d+:(\d+):/);
    if (match) {
      // Line-number errors: show at specific line
      const lineNum = parseInt(match[1], 10) - 1; // VS Code is 0-based
      
      // Parse pass name from error message (format: "PassName: ERROR: ...")
      const passNameMatch = errorText.match(/^([^:]+):\s*ERROR:/);
      let targetUri: vscode.Uri | null = null;
      
      if (passNameMatch && this.currentShaderConfig) {
        const passName = passNameMatch[1].trim();
        targetUri = this.getUriForPass(passName, this.currentShaderConfig);
      }
      
      // Fallback to active editor if we can't determine the target file
      if (!targetUri) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "glsl") {
          targetUri = editor.document.uri;
        }
      }
      
      if (targetUri) {
        try {
          const document = vscode.workspace.textDocuments.find(doc => doc.uri === targetUri);
          if (document && lineNum < document.lineCount) {
            const range = document.lineAt(lineNum).range;
            const diagnostic = new vscode.Diagnostic(
              range,
              errorText,
              vscode.DiagnosticSeverity.Error,
            );
            this.diagnosticCollection.set(targetUri, [diagnostic]);
          }
        } catch (err) {
          this.outputChannel.error(`Failed to create diagnostic: ${err}`);
        }
      }
    } else {
      // All non-line-number errors: show at line 1
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const document = editor.document;
        if (document.lineCount > 0) {
          const range = document.lineAt(0).range; // Line 1 (0-indexed as 0)
          const diagnostic = new vscode.Diagnostic(
            range,
            errorText,
            vscode.DiagnosticSeverity.Error,
          );
          this.diagnosticCollection.set(document.uri, [diagnostic]);
        }
      }
    }
  }

  public clearErrors(): void {
    // Clear all diagnostics when shader compilation succeeds
    this.diagnosticCollection.clear();
    
    // Also log the success message for debugging
    this.outputChannel.debug("Shader compiled and linked");
  }

  private getUriForPass(passName: string, shaderConfig: { config: any; shaderPath: string }): vscode.Uri | null {
    try {
      // If it's the main Image pass, return the main shader file
      if (passName === "Image") {
        return vscode.Uri.file(shaderConfig.shaderPath);
      }
      
      // For other passes, look up the buffer file path
      if (shaderConfig.config.passes && shaderConfig.config.passes[passName]) {
        const passConfig = shaderConfig.config.passes[passName];
        if (passConfig.path) {
          // Convert relative path to absolute path
          const shaderDir = shaderConfig.shaderPath.substring(0, shaderConfig.shaderPath.lastIndexOf('/'));
          const fullPath = vscode.Uri.joinPath(vscode.Uri.file(shaderDir), passConfig.path);
          return fullPath;
        }
      }
      
      return null;
    } catch (err) {
      this.outputChannel.error(`Error resolving URI for pass ${passName}: ${err}`);
      return null;
    }
  }
}

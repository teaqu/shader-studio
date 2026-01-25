import * as vscode from "vscode";
import { ErrorMessage } from "@shader-studio/types";

export class ErrorHandler {
  private currentShaderConfig: { config: any; shaderPath: string } | null = null;
  private recentErrors = new Map<string, number>();
  private readonly DEBOUNCE_MS = 500; // 0.5 second debounce
  private persistentErrors = new Map<string, { diagnostic: vscode.Diagnostic; uri: vscode.Uri; lastSeen: number }>(); // Track persistent errors until fixed
  private readonly PERSISTENT_TIMEOUT_MS = 2000; // 2 seconds timeout for persistent errors
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    // Start periodic cleanup timer
    this.startCleanupTimer();
  }

  public dispose(): void {
    // Clean up timer when ErrorHandler is disposed
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public setShaderConfig(config: { config: any; shaderPath: string } | null): void {
    this.currentShaderConfig = config;
  }

  public handleError(message: ErrorMessage): void {
    if (!message || !message.payload) {
      return; // Skip invalid messages
    }
    
    let errorText = Array.isArray(message.payload)
      ? message.payload.join(" ")
      : message.payload;
    
    if (!errorText) {
      return; // Skip empty messages
    }
    
    // Normalize error message to extract the core issue (file path)
    const normalizedError = this.normalizeErrorMessage(errorText);
    
    // Check if this normalized error was recently shown (debounce)
    const now = Date.now();
    const lastShown = this.recentErrors.get(normalizedError);
    
    if (lastShown && (now - lastShown) < this.DEBOUNCE_MS) {
      // Skip this error - it was shown recently
      console.log(`[ErrorHandler] Debounced: ${normalizedError} (${now - lastShown}ms ago)`);
      return;
    }
    
    // Record this normalized error as shown
    this.recentErrors.set(normalizedError, now);
    console.log(`[ErrorHandler] Showing: ${normalizedError}`);
    
    // Clean up old errors from the map (prevent memory leak)
    this.cleanupOldErrors(now);
    
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

  public handlePersistentError(message: ErrorMessage): void {
    if (!message || !message.payload) {
      return; // Skip invalid messages
    }
    
    let errorText = Array.isArray(message.payload)
      ? message.payload.join(" ")
      : message.payload;
    
    if (!errorText) {
      return; // Skip empty messages
    }
    
    // Normalize error message to extract the core issue (file path)
    const normalizedError = this.normalizeErrorMessage(errorText);
    
    // Check if this normalized error was recently shown (debounce)
    const now = Date.now();
    const lastShown = this.recentErrors.get(normalizedError);
    
    if (lastShown && (now - lastShown) < this.DEBOUNCE_MS) {
      // Skip this error - it was shown recently
      console.log(`[ErrorHandler] Debounced persistent: ${normalizedError} (${now - lastShown}ms ago)`);
      return;
    }
    
    // Record this normalized error as shown
    this.recentErrors.set(normalizedError, now);
    console.log(`[ErrorHandler] Showing persistent: ${normalizedError}`);
    
    // Store the diagnostic for persistence
    const diagnosticInfo = this.createPersistentDiagnostic(errorText);
    if (diagnosticInfo) {
      this.persistentErrors.set(normalizedError, {
        ...diagnosticInfo,
        lastSeen: now
      });
      this.diagnosticCollection.set(diagnosticInfo.uri, [diagnosticInfo.diagnostic]);
    }
    
    // Clean up old errors from the map (prevent memory leak)
    this.cleanupOldErrors(now);
    
    // Clean up expired persistent errors
    this.cleanupExpiredPersistentErrors(now);
    
    this.outputChannel.error(errorText);
  }

  public clearErrors(): void {
    // Clear all diagnostics when shader compilation succeeds
    this.diagnosticCollection.clear();
    
    // Clean up expired persistent errors and restore remaining ones
    const now = Date.now();
    this.cleanupExpiredPersistentErrors(now);
    this.restorePersistentErrors();
    
    // Also log the success message for debugging
    this.outputChannel.debug("Shader compiled and linked");
  }

  public clearPersistentError(normalizedError: string): void {
    // Remove specific persistent error when it's actually fixed
    this.persistentErrors.delete(normalizedError);
    this.recentErrors.delete(normalizedError);
    
    // Refresh diagnostics to show updated state
    this.restorePersistentErrors();
  }

  private restorePersistentErrors(): void {
    // Restore all non-expired persistent errors to the diagnostic collection
    const now = Date.now();
    for (const [normalizedError, diagnosticInfo] of this.persistentErrors.entries()) {
      if (now - diagnosticInfo.lastSeen < this.PERSISTENT_TIMEOUT_MS) {
        this.diagnosticCollection.set(diagnosticInfo.uri, [diagnosticInfo.diagnostic]);
      }
    }
  }

  private cleanupExpiredPersistentErrors(now: number): void {
    // Remove persistent errors that haven't been seen recently
    for (const [normalizedError, diagnosticInfo] of this.persistentErrors.entries()) {
      if (now - diagnosticInfo.lastSeen > this.PERSISTENT_TIMEOUT_MS) {
        this.persistentErrors.delete(normalizedError);
        console.log(`[ErrorHandler] Expired persistent error: ${normalizedError}`);
      }
    }
  }

  private startCleanupTimer(): void {
    // Run cleanup every 500ms to check for expired persistent errors
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const hadErrors = this.persistentErrors.size > 0;
      
      this.cleanupExpiredPersistentErrors(now);
      
      // If we had errors and now they're gone, refresh diagnostics
      if (hadErrors && this.persistentErrors.size === 0) {
        this.diagnosticCollection.clear();
      }
    }, 500);
  }

  private createPersistentDiagnostic(errorText: string): { diagnostic: vscode.Diagnostic; uri: vscode.Uri } | null {
    // For persistent errors, always show in the active shader file at line 1
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "glsl") {
      const document = editor.document;
      if (document.lineCount > 0) {
        const range = document.lineAt(0).range; // Line 1 (0-indexed as 0)
        const diagnostic = new vscode.Diagnostic(
          range,
          errorText,
          vscode.DiagnosticSeverity.Error,
        );
        return { diagnostic, uri: document.uri };
      }
    }
    return null;
  }

  private cleanupOldErrors(now: number): void {
    // Remove errors older than DEBOUNCE_MS from the map
    for (const [errorText, timestamp] of this.recentErrors.entries()) {
      if (now - timestamp > this.DEBOUNCE_MS) {
        this.recentErrors.delete(errorText);
      }
    }
  }

  private normalizeErrorMessage(errorText: string): string {
    // Extract file path from various error message formats
    const pathMatch = errorText.match(/[:\s]([\/][^\s]+(?:\.[a-zA-Z0-9]+)?)/);
    if (pathMatch) {
      const filePath = pathMatch[1];
      return `FILE_NOT_FOUND:${filePath}`;
    }
    
    // For other errors, just return the original text
    return errorText;
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

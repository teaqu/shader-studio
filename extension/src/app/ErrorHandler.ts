import * as vscode from "vscode";
import { CompileDiagnosticScope, ErrorMessage, SlangDiagnostic, WarningMessage } from "@shader-studio/types";

interface ScopedDiagnosticSet {
  scope: CompileDiagnosticScope;
  diagnostics: Array<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic }>;
}

export class ErrorHandler {
  private currentShaderConfig: { config: any; shaderPath: string; bufferPathMap?: Record<string, string> } | null = null;
  private recentErrors = new Map<string, number>();
  private readonly DEBOUNCE_MS = 500; // 0.5 second debounce
  private persistentErrors = new Map<string, { diagnostic: vscode.Diagnostic; uri: vscode.Uri; lastSeen: number }>(); // Track persistent errors until editor change
  private cleanupTimer: NodeJS.Timeout | null = null;
  private textChangeDisposable: vscode.Disposable | null = null;
  private lastChangedGlslUri: vscode.Uri | null = null;
  /** Replaceable compiler diagnostics, isolated by root URI and panel owner. */
  private scopedDiagnostics = new Map<string, ScopedDiagnosticSet>();
  /** Last accepted compiler generation for the same root/owner pair. */
  private latestCompileGenerations = new Map<string, number>();

  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: vscode.DiagnosticCollection,
  ) {
    this.setupEditorChangeListener();
  }

  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.textChangeDisposable) {
      this.textChangeDisposable.dispose();
      this.textChangeDisposable = null;
    }
  }

  public setShaderConfig(config: { config: any; shaderPath: string; bufferPathMap?: Record<string, string> } | null): void {
    this.currentShaderConfig = config;
  }

  private setupEditorChangeListener(): void {
    // Clear diagnostics when a GLSL file is edited, since recompilation will
    // produce fresh errors. Don't clear on editor switch — errors on other
    // files (e.g. common buffer) must remain visible.
    this.textChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (this.isGlslDocument(event.document)) {
        this.lastChangedGlslUri = event.document.uri;
        this.clearPersistentErrors();
      }
    });
  }

  public clearPersistentErrors(): void {
    // Clear all persistent errors when editor changes or a fresh shader load begins
    this.persistentErrors.clear();
    this.recentErrors.clear();
    this.scopedDiagnostics.clear();
    this.latestCompileGenerations.clear();
    this.diagnosticCollection.clear();
  }

  public handleError(message: ErrorMessage): void {
    if (!message || !message.payload) {
      return; // Skip invalid messages
    }

    const scope = this.getValidCompileScope(message.compileScope);
    const diagnostics = this.getValidCompilerDiagnostics(message.diagnostics);
    if (scope && diagnostics) {
      this.handleScopedCompilerDiagnostics(scope, diagnostics);
      return;
    }

    const errors = Array.isArray(message.payload) ? message.payload : [message.payload];

    if (errors.length === 0) {
      return; // Skip empty messages
    }

    const now = Date.now();

    // Accumulate diagnostics per URI
    const diagnosticsMap = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

    for (const errorText of errors) {
      if (!errorText) {
        continue;
      }

      // Normalize error message to extract the core issue (file path)
      const normalizedError = this.normalizeErrorMessage(errorText);

      // Check if this normalized error was recently shown (debounce)
      const lastShown = this.recentErrors.get(normalizedError);

      if (lastShown && (now - lastShown) < this.DEBOUNCE_MS) {
        continue;
      }

      // Record this normalized error as shown
      this.recentErrors.set(normalizedError, now);

      this.outputChannel.error(errorText);

      const match = errorText.match(/ERROR:\s*\d+:(\d+):/);
      if (match) {
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
          targetUri = this.getDefaultTargetUri();
        }

        if (targetUri) {
          try {
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === targetUri!.fsPath);
            let range: vscode.Range;
            if (document && lineNum < document.lineCount) {
              range = document.lineAt(lineNum).range;
            } else {
              range = new vscode.Range(lineNum, 0, lineNum, 0);
            }
            const diagnostic = new vscode.Diagnostic(
              range,
              errorText,
              vscode.DiagnosticSeverity.Error,
            );

            const key = targetUri.fsPath;
            if (!diagnosticsMap.has(key)) {
              diagnosticsMap.set(key, { uri: targetUri, diagnostics: [] });
            }
            diagnosticsMap.get(key)!.diagnostics.push(diagnostic);
          } catch (err) {
            this.outputChannel.error(`Failed to create diagnostic: ${err}`);
          }
        }
      } else {
        // All non-line-number errors: show at line 1
        const targetInfo = this.getTargetDocumentInfo();
        if (targetInfo && targetInfo.lineCount > 0) {
          const range = targetInfo.lineAt(0).range;
          const diagnostic = new vscode.Diagnostic(
            range,
            errorText,
            vscode.DiagnosticSeverity.Error,
          );

          const key = targetInfo.uri.fsPath;
          if (!diagnosticsMap.has(key)) {
            diagnosticsMap.set(key, { uri: targetInfo.uri, diagnostics: [] });
          }
          diagnosticsMap.get(key)!.diagnostics.push(diagnostic);
        }
      }
    }

    // Set all accumulated diagnostics at once per URI
    for (const { uri, diagnostics } of diagnosticsMap.values()) {
      this.diagnosticCollection.set(uri, diagnostics);
    }

    // Clean up old errors from the map (prevent memory leak)
    this.cleanupOldErrors(now);
  }

  public handlePersistentError(message: ErrorMessage | WarningMessage): void {
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
      return;
    }

    // Record this normalized error as shown
    this.recentErrors.set(normalizedError, now);

    // Store the diagnostic for persistence
    const diagnosticInfo = this.createPersistentDiagnostic(errorText, message.type);
    if (diagnosticInfo) {
      this.persistentErrors.set(normalizedError, {
        ...diagnosticInfo,
        lastSeen: now
      });
      this.publishDiagnosticsForUri(diagnosticInfo.uri);
    }

    // Clean up old errors from the map (prevent memory leak)
    this.cleanupOldErrors(now);

    // Use appropriate log level based on message type
    if (message.type === 'warning') {
      this.outputChannel.warn(errorText);
    } else {
      this.outputChannel.error(errorText);
    }
  }

  public clearErrors(): void {
    // Clear only regular errors when shader compilation succeeds
    // Keep persistent errors (warnings) until editor change
    this.diagnosticCollection.clear();
    this.restorePersistentErrors();

    // Also log the success message for debugging
    this.outputChannel.debug("Shader compiled and linked");
  }

  /**
   * Clears only diagnostics belonging to a successful compiler scope.  A raw
   * legacy success intentionally continues through clearErrors(), preserving
   * the behaviour of existing GLSL and non-structured render messages.
   */
  public handleCompileSuccess(scope: CompileDiagnosticScope | undefined): void {
    const validScope = this.getValidCompileScope(scope);
    if (!validScope || !this.acceptCompileScope(validScope)) {
      return;
    }

    const affectedUris = new Map<string, vscode.Uri>();
    for (const rootUri of validScope.rootUris) {
      const key = this.scopeKey(rootUri, validScope.ownerId);
      const previous = this.scopedDiagnostics.get(key);
      if (previous) {
        this.collectSetUris(previous, affectedUris);
      }
      this.scopedDiagnostics.delete(key);
    }
    for (const uri of affectedUris.values()) {
      this.publishDiagnosticsForUri(uri);
    }
  }

  private restorePersistentErrors(): void {
    // Restore all persistent errors to the diagnostic collection
    for (const [normalizedError, diagnosticInfo] of this.persistentErrors.entries()) {
      this.diagnosticCollection.set(diagnosticInfo.uri, [diagnosticInfo.diagnostic]);
    }
  }

  private handleScopedCompilerDiagnostics(
    scope: CompileDiagnosticScope,
    diagnostics: Array<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic }>,
  ): void {
    if (!this.acceptCompileScope(scope)) {
      return;
    }

    const affectedUris = new Map<string, vscode.Uri>();
    for (const rootUri of scope.rootUris) {
      const key = this.scopeKey(rootUri, scope.ownerId);
      const previous = this.scopedDiagnostics.get(key);
      if (previous) {
        this.collectSetUris(previous, affectedUris);
      }
      const next: ScopedDiagnosticSet = { scope, diagnostics };
      this.scopedDiagnostics.set(key, next);
      this.collectSetUris(next, affectedUris);
    }
    for (const uri of affectedUris.values()) {
      this.publishDiagnosticsForUri(uri);
    }
  }

  private getValidCompileScope(scope: CompileDiagnosticScope | undefined): CompileDiagnosticScope | null {
    if (!scope || !Array.isArray(scope.rootUris)) {
      return null;
    }
    const rootUris = [...new Set(scope.rootUris.filter((uri) => typeof uri === 'string' && uri.length > 0))].sort();
    if (rootUris.length === 0 || rootUris.length !== scope.rootUris.length) {
      return null;
    }
    if (scope.ownerId !== undefined && (typeof scope.ownerId !== 'string' || scope.ownerId.length === 0)) {
      return null;
    }
    if (scope.generationId !== undefined && (!Number.isSafeInteger(scope.generationId) || scope.generationId < 0)) {
      return null;
    }
    return { rootUris, ownerId: scope.ownerId, generationId: scope.generationId };
  }

  private acceptCompileScope(scope: CompileDiagnosticScope): boolean {
    if (scope.generationId === undefined) {
      return true;
    }
    if (scope.rootUris.some((rootUri) => (this.latestCompileGenerations.get(this.scopeKey(rootUri, scope.ownerId)) ?? -1) > scope.generationId!)) {
      return false;
    }
    for (const rootUri of scope.rootUris) {
      this.latestCompileGenerations.set(this.scopeKey(rootUri, scope.ownerId), scope.generationId);
    }
    return true;
  }

  private scopeKey(rootUri: string, ownerId: string | undefined): string {
    return `${rootUri}\u0000${ownerId ?? ''}`;
  }

  private getValidCompilerDiagnostics(
    diagnostics: SlangDiagnostic[] | undefined,
  ): Array<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic }> | null {
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
      return null;
    }
    const mapped: Array<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic }> = [];
    for (const diagnostic of diagnostics) {
      const result = this.toVscodeDiagnostic(diagnostic);
      if (!result) {
        return null;
      }
      mapped.push(result);
    }
    return mapped;
  }

  private toVscodeDiagnostic(diagnostic: SlangDiagnostic): { uri: vscode.Uri; diagnostic: vscode.Diagnostic } | null {
    try {
      if (!diagnostic || typeof diagnostic !== 'object'
        || typeof diagnostic.uri !== 'string'
        || typeof diagnostic.message !== 'string'
        || diagnostic.message.length === 0
        || !['error', 'warning', 'information', 'hint'].includes(diagnostic.severity)
        || !['slang-compile', 'webgpu'].includes(diagnostic.source)
        || (diagnostic.code !== undefined && typeof diagnostic.code !== 'string')
        || (diagnostic.passName !== undefined && typeof diagnostic.passName !== 'string')
        || !this.isValidDiagnosticRange(diagnostic.range)) {
        return null;
      }
      const uri = vscode.Uri.parse(diagnostic.uri, true);
      if (!uri.scheme) {
        return null;
      }
      const range = new vscode.Range(
        diagnostic.range.start.line,
        diagnostic.range.start.character,
        diagnostic.range.end.line,
        diagnostic.range.end.character,
      );
      const severity = {
        error: vscode.DiagnosticSeverity.Error,
        warning: vscode.DiagnosticSeverity.Warning,
        information: vscode.DiagnosticSeverity.Information,
        hint: vscode.DiagnosticSeverity.Hint,
      }[diagnostic.severity];
      const result = new vscode.Diagnostic(range, diagnostic.message, severity);
      result.source = diagnostic.source;
      result.code = diagnostic.code;
      return { uri, diagnostic: result };
    } catch {
      return null;
    }
  }

  private isValidDiagnosticRange(range: SlangDiagnostic['range']): boolean {
    if (!range || typeof range !== 'object' || !range.start || !range.end) {
      return false;
    }
    const values = [range.start.line, range.start.character, range.end.line, range.end.character];
    if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      return false;
    }
    return range.end.line > range.start.line
      || (range.end.line === range.start.line && range.end.character >= range.start.character);
  }

  private collectSetUris(set: ScopedDiagnosticSet, target: Map<string, vscode.Uri>): void {
    for (const entry of set.diagnostics) {
      target.set(entry.uri.toString(), entry.uri);
    }
  }

  private publishDiagnosticsForUri(uri: vscode.Uri): void {
    const diagnostics: vscode.Diagnostic[] = [];
    const published = new Set<string>();
    for (const set of this.scopedDiagnostics.values()) {
      for (const entry of set.diagnostics) {
        if (entry.uri.toString() === uri.toString()) {
          const key = this.diagnosticKey(entry.diagnostic);
          if (!published.has(key)) {
            published.add(key);
            diagnostics.push(entry.diagnostic);
          }
        }
      }
    }
    for (const persistent of this.persistentErrors.values()) {
      if (persistent.uri.toString() === uri.toString()) {
        const key = this.diagnosticKey(persistent.diagnostic);
        if (!published.has(key)) {
          published.add(key);
          diagnostics.push(persistent.diagnostic);
        }
      }
    }
    this.diagnosticCollection.set(uri, diagnostics);
  }

  private diagnosticKey(diagnostic: vscode.Diagnostic): string {
    const { start, end } = diagnostic.range;
    return [
      diagnostic.message,
      diagnostic.source ?? '',
      diagnostic.code?.toString() ?? '',
      diagnostic.severity,
      start.line,
      start.character,
      end.line,
      end.character,
    ].join('\u0000');
  }

  private createPersistentDiagnostic(errorText: string, messageType?: string): { diagnostic: vscode.Diagnostic; uri: vscode.Uri } | null {
    const targetInfo = this.getTargetDocumentInfo();
    if (targetInfo && targetInfo.lineCount > 0) {
      const range = targetInfo.lineAt(0).range;
      const severity = messageType === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;

      const diagnostic = new vscode.Diagnostic(
        range,
        errorText,
        severity,
      );
      return { diagnostic, uri: targetInfo.uri };
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

  private getDefaultTargetUri(): vscode.Uri | null {
    if (this.lastChangedGlslUri) {
      return this.lastChangedGlslUri;
    }

    if (this.currentShaderConfig?.shaderPath) {
      return vscode.Uri.file(this.currentShaderConfig.shaderPath);
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && this.isGlslDocument(activeDocument)) {
      return activeDocument.uri;
    }

    if (activeDocument?.uri) {
      return activeDocument.uri;
    }

    return null;
  }

  private getTargetDocumentInfo(): vscode.TextDocument | { uri: vscode.Uri; lineCount: number; lineAt: (line: number) => { range: vscode.Range } } | null {
    const targetUri = this.getDefaultTargetUri();
    if (!targetUri) {
      return null;
    }

    const openDocument = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.fsPath === targetUri.fsPath,
    );
    if (openDocument) {
      return openDocument;
    }

    return {
      uri: targetUri,
      lineCount: 1,
      lineAt: (line: number) => ({
        range: new vscode.Range(line, 0, line, 0),
      }),
    };
  }

  private isGlslDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'glsl'
      || document.languageId === 'frag'
      || document.fileName.endsWith('.glsl')
      || document.fileName.endsWith('.frag');
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

  private getUriForPass(passName: string, shaderConfig: { config: any; shaderPath: string; bufferPathMap?: Record<string, string> }): vscode.Uri | null {
    try {
      // Use bufferPathMap if available (already has resolved absolute paths)
      if (shaderConfig.bufferPathMap && shaderConfig.bufferPathMap[passName]) {
        return vscode.Uri.file(shaderConfig.bufferPathMap[passName]);
      }

      // If it's the main Image pass, return the main shader file
      if (passName === "Image") {
        return vscode.Uri.file(shaderConfig.shaderPath);
      }

      // For other passes, look up the buffer file path from config
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

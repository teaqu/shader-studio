import * as vscode from "vscode";
import { ErrorMessage, WarningMessage } from "@shader-studio/types";
import type { DiagnosticSink } from "./DiagnosticArbiter";

export class ErrorHandler {
  private currentShaderConfig: { config: any; shaderPath: string; bufferPathMap?: Record<string, string> } | null = null;
  private recentErrors = new Map<string, number>();
  private readonly DEBOUNCE_MS = 500; // 0.5 second debounce
  private persistentErrors = new Map<string, { diagnostic: vscode.Diagnostic; uri: vscode.Uri; lastSeen: number }>(); // Track persistent errors until editor change
  private cleanupTimer: NodeJS.Timeout | null = null;
  private textChangeDisposable: vscode.Disposable | null = null;
  private lastChangedShaderUri: vscode.Uri | null = null;

  constructor(
    private outputChannel: vscode.LogOutputChannel,
    private diagnosticCollection: DiagnosticSink,
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
    // Clear diagnostics when a shader file is edited, since recompilation will
    // produce fresh errors. Don't clear on editor switch — errors on other
    // files (e.g. common buffer) must remain visible.
    this.textChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (this.isShaderDocument(event.document)) {
        this.lastChangedShaderUri = event.document.uri;
        this.clearPersistentErrors();
      }
    });
  }

  public clearPersistentErrors(): void {
    // Clear all persistent errors when editor changes or a fresh shader load begins
    this.persistentErrors.clear();
    this.recentErrors.clear();
    this.diagnosticCollection.clear();
  }

  public handleError(message: ErrorMessage): void {
    if (!message || !message.payload) {
      return; // Skip invalid messages
    }

    const errors = Array.isArray(message.payload) ? message.payload : [message.payload];

    if (errors.length === 0) {
      return; // Skip empty messages
    }

    const now = Date.now();

    // Accumulate diagnostics per URI
    const diagnosticsMap: DiagnosticsByUri = new Map();

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

      // Parse pass name from error message (format: "PassName: ERROR: ...").
      // Slang prefixes the pass onto the whole batch, so this is read once for
      // every block parsed out of this payload entry.
      const passNameMatch = errorText.match(/^([^:\n]+):\s*(?:ERROR:\s*|error(?:\[[^\]]+\])?:)/i);
      const passUri = passNameMatch && this.currentShaderConfig
        ? this.getUriForPass(passNameMatch[1].trim(), this.currentShaderConfig)
        : null;

      const reported = parseReportedDiagnostics(errorText);
      if (reported.length === 0) {
        this.addFallbackDiagnostic(errorText, diagnosticsMap);
        continue;
      }

      for (const entry of reported) {
        if (entry.line === undefined) {
          // A block the compiler didn't locate still has to surface somewhere.
          this.addFallbackDiagnostic(entry.message, diagnosticsMap);
          continue;
        }

        const lineNum = entry.line - 1; // VS Code is 0-based
        let targetUri: vscode.Uri | null = passUri;

        // Native Slang emits the source path on a separate `-->` line. Prefer
        // it when it identifies an open/configured module (not its synthetic
        // `/passname.slang` path), so imported-module diagnostics land on the
        // exact file that failed.
        if (entry.sourcePath) {
          targetUri = this.getUriForReportedSlangSource(entry.sourcePath) ?? targetUri;
        }

        // If Slang supplied a real path but it isn't open or in the active
        // shader configuration, still create a diagnostic for that file.
        if (!targetUri && entry.sourcePath) {
          targetUri = vscode.Uri.file(entry.sourcePath);
        }

        // Fallback to active editor if we can't determine the target file
        if (!targetUri) {
          targetUri = this.getDefaultTargetUri();
        }

        if (!targetUri) {
          continue;
        }

        try {
          const uri = targetUri;
          const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath);
          addDiagnostic(diagnosticsMap, uri, new vscode.Diagnostic(
            buildDiagnosticRange(document, lineNum, entry.column),
            entry.message,
            vscode.DiagnosticSeverity.Error,
          ));
        } catch (err) {
          this.outputChannel.error(`Failed to create diagnostic: ${err}`);
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

  private addFallbackDiagnostic(message: string, diagnosticsMap: DiagnosticsByUri): void {
    // Errors without a reported location: show at line 1
    const targetInfo = this.getTargetDocumentInfo();
    if (targetInfo && targetInfo.lineCount > 0) {
      addDiagnostic(diagnosticsMap, targetInfo.uri, new vscode.Diagnostic(
        targetInfo.lineAt(0).range,
        message,
        vscode.DiagnosticSeverity.Error,
      ));
    }
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
      this.diagnosticCollection.set(diagnosticInfo.uri, [diagnosticInfo.diagnostic]);
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

  private restorePersistentErrors(): void {
    // Restore all persistent errors to the diagnostic collection
    for (const [normalizedError, diagnosticInfo] of this.persistentErrors.entries()) {
      this.diagnosticCollection.set(diagnosticInfo.uri, [diagnosticInfo.diagnostic]);
    }
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
    if (this.lastChangedShaderUri) {
      return this.lastChangedShaderUri;
    }

    if (this.currentShaderConfig?.shaderPath) {
      return vscode.Uri.file(this.currentShaderConfig.shaderPath);
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && this.isShaderDocument(activeDocument)) {
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

  private isShaderDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'glsl'
      || document.languageId === 'frag'
      || document.languageId === 'slang'
      || document.fileName.endsWith('.glsl')
      || document.fileName.endsWith('.frag')
      || document.fileName.endsWith('.slang');
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

  private getUriForReportedSlangSource(sourcePath: string): vscode.Uri | null {
    const sourceUri = vscode.Uri.file(sourcePath);
    if (vscode.workspace.textDocuments.some((document) => document.uri.fsPath === sourceUri.fsPath)) {
      return sourceUri;
    }

    const config = this.currentShaderConfig;
    if (!config) {
      return null;
    }
    if (config.shaderPath === sourceUri.fsPath) {
      return sourceUri;
    }
    if (Object.values(config.bufferPathMap ?? {}).some((path) => path === sourceUri.fsPath)) {
      return sourceUri;
    }
    return null;
  }
}

type DiagnosticsByUri = Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>;

/** One compiler error. `line` is absent when the compiler reported no location. */
interface ReportedDiagnostic {
  message: string;
  line?: number;
  column?: number;
  sourcePath?: string;
}

function addDiagnostic(
  diagnosticsMap: DiagnosticsByUri,
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic,
): void {
  const existing = diagnosticsMap.get(uri.fsPath);
  if (existing) {
    existing.diagnostics.push(diagnostic);
    return;
  }
  diagnosticsMap.set(uri.fsPath, { uri, diagnostics: [diagnostic] });
}

function parseReportedDiagnostics(errorText: string): ReportedDiagnostic[] {
  // glslang only reports `<string>:<line>` (no column, so these stay
  // whole-line), and the renderer already splits its log one error per payload
  // entry. Checked first because `ERROR:` also matches the Slang heading below.
  const glslLine = errorText.match(/ERROR:\s*\d+:(\d+):/);
  if (glslLine) {
    return [{ message: errorText, line: Number.parseInt(glslLine[1], 10) }];
  }

  // Slang batches every diagnostic for a pass into one string. Each block opens
  // with an `error[...]:` heading (only the first carries the pass prefix) and
  // carries its own source-map-style location line, for example:
  //   Image: error[E30015]: undefined identifier 'stepp'
  //     --> /image.slang:14:15
  const headings = [...errorText.matchAll(/(?:^|\n)(?:[^:\n]+:[ \t]*)?error(?:\[[^\]]+\])?:[^\n]*/gi)];
  return headings.map((heading, index) => {
    const blockStart = heading.index ?? 0;
    const blockEnd = headings[index + 1]?.index ?? errorText.length;
    const block = errorText.slice(blockStart, blockEnd);
    const location = block.match(/^\s*-->\s+(.+?):(\d+)(?::(\d+))?\s*$/m);
    return {
      message: block.trim(),
      sourcePath: location?.[1],
      line: location ? Number.parseInt(location[2], 10) : undefined,
      column: location?.[3] === undefined ? undefined : Number.parseInt(location[3], 10),
    };
  });
}

/**
 * Compilers that report a column (Slang) get a range from that column to the
 * end of the line, matching the Monaco editor's markers. Compilers that don't
 * (glslang) keep the whole line highlighted.
 */
function buildDiagnosticRange(
  document: vscode.TextDocument | undefined,
  lineNum: number,
  column: number | undefined,
): vscode.Range {
  const lineEnd = document && lineNum < document.lineCount
    ? document.lineAt(lineNum).range.end.character
    : undefined;

  if (column === undefined) {
    return lineEnd === undefined
      ? new vscode.Range(lineNum, 0, lineNum, 0)
      : new vscode.Range(lineNum, 0, lineNum, lineEnd);
  }

  const reportedStart = Math.max(0, column - 1);
  if (lineEnd === undefined) {
    // The file isn't open, so the line length is unknown: highlight the single
    // reported character rather than an empty range.
    return new vscode.Range(lineNum, reportedStart, lineNum, reportedStart + 1);
  }

  // A column past the end of the line (Slang points at EOL for unterminated
  // constructs) still needs a visible squiggle on the last character.
  const start = Math.min(reportedStart, Math.max(0, lineEnd - 1));
  return new vscode.Range(lineNum, start, lineNum, lineEnd);
}

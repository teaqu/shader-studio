import * as vscode from "vscode";
import type { ShaderLanguage } from "@shader-studio/language-server-core";

/** The slice of `vscode.DiagnosticCollection` diagnostic producers actually use. */
export interface DiagnosticSink {
  set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[] | undefined): void;
  delete(uri: vscode.Uri): void;
  clear(): void;
}

/**
 * The renderer compiler and the language servers both report on the same lines,
 * so a single mistake used to be squiggled twice. This arbiter keeps whichever
 * report came from the real compiler for that language:
 *
 * - Slang: the language service *is* the Slang compiler, and it reports columns
 *   and error codes the renderer payload loses, so its diagnostics win.
 * - GLSL: the renderer errors come from the driver (`getShaderInfoLog`) while
 *   the GLSL service is a hand-written analyser, so the compiler wins.
 *
 * Only errors suppress errors, and only on the same line: warnings, and the
 * link/binding failures no language service can see, always survive.
 */
export class DiagnosticArbiter {
  private readonly compilerEntries = new Map<string, Entry>();
  private readonly serviceEntries: Record<ShaderLanguage, Map<string, Entry>> = {
    glsl: new Map(),
    slang: new Map(),
  };

  constructor(
    private readonly collections: { compiler: DiagnosticSink } & Record<ShaderLanguage, DiagnosticSink>,
  ) {}

  /** Sink for renderer compiler errors, handed to the ErrorHandler. */
  compilerSink(): DiagnosticSink {
    return {
      set: (uri, diagnostics) => this.record(this.compilerEntries, uri, diagnostics),
      delete: (uri) => this.record(this.compilerEntries, uri, []),
      clear: () => this.clearEntries(this.compilerEntries, this.collections.compiler),
    };
  }

  /** Sink for one language service, handed to the language service controller. */
  languageServiceSink(language: ShaderLanguage): DiagnosticSink {
    return {
      set: (uri, diagnostics) => this.recordService(language, uri, diagnostics),
      delete: (uri) => this.recordService(language, uri, []),
      clear: () => this.clearEntries(this.serviceEntries[language], this.collections[language]),
    };
  }

  /**
   * A document has one language at a time, so the reporting service takes the
   * URI from the other one. VS Code hands the same untitled name to whatever
   * buffer holds it next, and a file can have its language mode changed.
   */
  private recordService(language: ShaderLanguage, uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[] | undefined): void {
    const other: ShaderLanguage = language === "slang" ? "glsl" : "slang";
    if (this.serviceEntries[other].delete(uri.fsPath)) {
      this.collections[other].delete(uri);
    }
    this.record(this.serviceEntries[language], uri, diagnostics);
  }

  private record(entries: Map<string, Entry>, uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[] | undefined): void {
    entries.set(uri.fsPath, { uri, diagnostics: [...(diagnostics ?? [])] });
    this.republish(uri);
  }

  private clearEntries(entries: Map<string, Entry>, collection: DiagnosticSink): void {
    const cleared = [...entries.values()];
    entries.clear();
    collection.clear();
    for (const entry of cleared) {
      this.republish(entry.uri);
    }
  }

  private republish(uri: vscode.Uri): void {
    const language = this.languageFor(uri);
    const compiler = this.compilerEntries.get(uri.fsPath)?.diagnostics ?? [];
    const service = this.serviceEntries[language].get(uri.fsPath)?.diagnostics ?? [];

    if (language === "slang") {
      this.collections.compiler.set(uri, suppressDuplicateDiagnostics(service, compiler));
      this.collections.slang.set(uri, service);
      return;
    }
    this.collections.compiler.set(uri, compiler);
    this.collections.glsl.set(uri, suppressDuplicateDiagnostics(compiler, service));
  }

  /**
   * The service that reported owns the document: an untitled Slang buffer has
   * no `.slang` path to read the language off, so only its own report says so.
   * The path answers for a file nothing has analysed yet, such as a renderer
   * error arriving before any language service ran.
   */
  private languageFor(uri: vscode.Uri): ShaderLanguage {
    if (this.serviceEntries.slang.has(uri.fsPath)) {
      return "slang";
    }
    if (this.serviceEntries.glsl.has(uri.fsPath)) {
      return "glsl";
    }
    return languageForPath(uri.fsPath);
  }
}

interface Entry {
  uri: vscode.Uri;
  diagnostics: vscode.Diagnostic[];
}

/** Drops the loser's errors on lines the winner already reported an error on. */
export function suppressDuplicateDiagnostics(
  winner: readonly vscode.Diagnostic[],
  loser: readonly vscode.Diagnostic[],
): vscode.Diagnostic[] {
  const claimed = new Set(winner.filter(isError).map((diagnostic) => diagnostic.range.start.line));
  if (claimed.size === 0) {
    return [...loser];
  }
  return loser.filter((diagnostic) => !isError(diagnostic) || !claimed.has(diagnostic.range.start.line));
}

function isError(diagnostic: vscode.Diagnostic): boolean {
  return diagnostic.severity === vscode.DiagnosticSeverity.Error;
}

/** Slang files are the only ones the Slang service owns; everything else is GLSL. */
export function languageForPath(fsPath: string): ShaderLanguage {
  return fsPath.toLowerCase().endsWith(".slang") ? "slang" : "glsl";
}

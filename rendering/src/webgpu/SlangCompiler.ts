import type { SlangDiagnostic, SlangWorkspaceSnapshot } from "@shader-studio/types";
import { splitSlangRootHeader } from "./SlangLanguageHeader";
import { releaseWorkspaceFileSystem, syncWorkspaceToFileSystem } from "./SlangWorkspaceFileSystem";
import {
  type SlangComponentType,
  type SlangEmbindHandle,
  type SlangGlobalSession,
  type SlangModuleApi,
  slangVectorToArray,
} from "./slangTypes";
import {
  SLANG_ENTRY_FRAGMENT,
  SLANG_ENTRY_VERTEX,
  type SlangWrapOptions,
  wrapSlangWorkspaceRoot,
} from "./SlangPrelude";

export const PINNED_SLANG_COMPILER_VERSION = "2026.10.2";

export type SlangCompileOptions = SlangWrapOptions;
export interface SlangCompileRequest {
  source: string;
  sourceUri: string;
  sourcePath: string;
  workspace: SlangWorkspaceSnapshot;
  options: SlangCompileOptions;
}
export type SlangCompileResult =
  | { success: true; wgsl: string; diagnostics: SlangDiagnostic[] }
  // Optional at the type boundary while Task 4 still produces legacy failures;
  // SlangCompiler itself always supplies it.
  | { success: false; errors: string[]; diagnostics?: SlangDiagnostic[] };

/** Synchronous workspace compiler. Per-request Embind values are always released. */
export class SlangCompiler {
  private globalSession: SlangGlobalSession | null = null;
  private wgslTargetValue: number | null = null;
  private readonly ownedPaths = new Set<string>();
  private disposed = false;

  constructor(private readonly slang: SlangModuleApi) {}

  public compile(request: SlangCompileRequest): SlangCompileResult {
    if (this.disposed) return failure("Slang compiler has been disposed", request.sourceUri);
    const header = splitSlangRootHeader(request.source);
    const diagnostics = header.diagnostics.map((diagnostic) => diagnosticFor(
      diagnostic.message, request.sourceUri, diagnostic.line,
    ));
    if (diagnostics.length) return { success: false, errors: diagnostics.map(({ message }) => message), diagnostics };
    const fs = this.slang.FS;
    if (!fs) return failure("Slang: WASM filesystem is unavailable", request.sourceUri, diagnostics);
    try {
      syncWorkspaceToFileSystem(fs, request.workspace, this.ownedPaths);
    } catch (error) {
      return failure(errMessage(error), request.sourceUri, diagnostics);
    }

    let sessionHandles: SlangEmbindHandle[] = [];
    try {
      const { globalSession, target } = this.ensureGlobalSession();
      const session = globalSession.createSession(target);
      if (!session) return this.lastFailure("Slang: failed to create session", request, diagnostics);
      sessionHandles = [session];
      const moduleName = safeModuleName(request.options.passName ?? basename(request.sourcePath));
      const module = session.loadModuleFromSource(
        wrapSlangWorkspaceRoot(header.header, header.body, request.options), moduleName, request.sourcePath,
      );
      if (!module) return this.lastFailure("Slang: failed to compile module", request, diagnostics);
      sessionHandles.push(module);
      const vs = module.findEntryPointByName(SLANG_ENTRY_VERTEX);
      const fragment = module.findEntryPointByName(SLANG_ENTRY_FRAGMENT);
      if (!vs || !fragment) return this.lastFailure("Slang: entry points not found (is `mainImage` defined?)", request, diagnostics);
      sessionHandles.push(vs, fragment);
      const composite = session.createCompositeComponentType([module, vs, fragment]);
      if (!composite) return this.lastFailure("Slang: failed to compose program", request, diagnostics);
      sessionHandles.push(composite);
      const linked = composite.link();
      if (!linked) return this.lastFailure("Slang: failed to link program", request, diagnostics);
      sessionHandles.push(linked);
      const wgsl = linked.getTargetCode(0);
      if (!wgsl) return this.lastFailure("Slang: produced empty WGSL", request, diagnostics);
      return { success: true, wgsl, diagnostics };
    } catch (error) {
      return failure(errMessage(error), request.sourceUri, diagnostics);
    } finally {
      deleteHandles(sessionHandles);
    }
  }

  /** @deprecated Task 4 migrates worker and engine callers to compile(request). */
  public compileImagePass(source: string, options: SlangCompileOptions = {}): SlangCompileResult {
    const name = safeModuleName(options.passName ?? "image");
    const path = `/workspace/${name}.slang`;
    const uri = `file://${path}`;
    return this.compile({
      source, sourceUri: uri, sourcePath: path,
      workspace: { rootUri: uri, files: [{ path, uri, source }] }, options,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.slang.FS) {
      try { releaseWorkspaceFileSystem(this.slang.FS, this.ownedPaths); } catch { /* retained for retry-free disposal */ }
    }
    const global = this.globalSession;
    this.globalSession = null;
    this.wgslTargetValue = null;
    deleteHandles(global ? [global] : []);
  }

  private ensureGlobalSession(): { globalSession: SlangGlobalSession; target: number } {
    if (this.globalSession && this.wgslTargetValue !== null) return { globalSession: this.globalSession, target: this.wgslTargetValue };
    const globalSession = this.slang.createGlobalSession();
    if (!globalSession) throw new Error("Slang: createGlobalSession returned null");
    const wgsl = slangVectorToArray(this.slang.getCompileTargets()).find((target) => /wgsl/i.test(target.name));
    if (!wgsl) {
      deleteHandles([globalSession]);
      throw new Error(`Slang: no WGSL compile target (available: ${slangVectorToArray(this.slang.getCompileTargets()).map((target) => target.name).join(", ") || "none"})`);
    }
    this.globalSession = globalSession;
    this.wgslTargetValue = wgsl.value;
    return { globalSession, target: wgsl.value };
  }

  private lastFailure(fallback: string, request: SlangCompileRequest, diagnostics: SlangDiagnostic[]): SlangCompileResult {
    const message = this.lastError(fallback);
    return { success: false, errors: [message], diagnostics: [...diagnostics, ...parseDiagnostics(message, request.workspace, request.sourceUri)] };
  }

  private lastError(fallback: string): string {
    const message = this.slang.getLastError?.()?.message?.trim();
    return message || fallback;
  }
}

function deleteHandles(handles: SlangEmbindHandle[]): void {
  const unique: SlangEmbindHandle[] = [];
  for (const handle of handles) {
    if (!unique.some((previous) => handle === previous || handle.isAliasOf?.(previous) || previous.isAliasOf?.(handle))) unique.push(handle);
  }
  for (const handle of unique.reverse()) {
    try { handle.delete?.(); } catch { /* cleanup must not replace a compiler result */ }
  }
}

function failure(message: string, uri: string, diagnostics: SlangDiagnostic[] = []): SlangCompileResult {
  return { success: false, errors: [message], diagnostics: diagnostics.length ? diagnostics : [diagnosticFor(message, uri)] };
}

function diagnosticFor(message: string, uri: string, line = 0, character = 0, code?: string): SlangDiagnostic {
  return { severity: "error", message, source: "slang-compile", uri, range: { start: { line, character }, end: { line, character } }, ...(code ? { code } : {}) };
}

function parseDiagnostics(message: string, workspace: SlangWorkspaceSnapshot, fallbackUri: string): SlangDiagnostic[] {
  const match = message.match(/(?:error|warning)(?:\[([A-Z]\d+)\])?:\s*([^\n]+)\n\s*-->\s*(\/workspace\/[^:\n]+):(\d+):(\d+)/i);
  if (!match) return [diagnosticFor(message, fallbackUri)];
  const file = workspace.files.find(({ path }) => path === match[3]);
  return [diagnosticFor(match[2], file?.uri ?? fallbackUri, Number(match[4]) - 1, Number(match[5]) - 1, match[1])];
}

function basename(path: string): string {
  const segments = path.split("/");
  return (segments[segments.length - 1] || "image").replace(/\.slang$/i, "");
}
function safeModuleName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "image"; }
function errMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

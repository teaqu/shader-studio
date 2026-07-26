import type { SlangDiagnostic, SlangLanguageVersion, SlangWorkspaceSnapshot } from "@shader-studio/types";
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

export type SlangCompileOptions = SlangWrapOptions & { languageVersion?: SlangLanguageVersion };
export interface SlangCompileRequest {
  source: string;
  sourceUri: string;
  sourcePath: string;
  workspace: SlangWorkspaceSnapshot;
  options: SlangCompileOptions;
}
export type SlangCompileTargetName = "WGSL" | "HLSL";
type SlangCompileFailure = { success: false; errors: string[]; diagnostics: SlangDiagnostic[] };
export type SlangCompileResult =
  | { success: true; wgsl: string; diagnostics: SlangDiagnostic[] }
  | SlangCompileFailure;
export type SlangTargetCompileResult =
  | { success: true; target: SlangCompileTargetName; code: string; diagnostics: SlangDiagnostic[] }
  | SlangCompileFailure;

/** Synchronous workspace compiler. Per-request Embind values are always released. */
export class SlangCompiler {
  private globalSession: SlangGlobalSession | null = null;
  private readonly targetValues = new Map<SlangCompileTargetName, number>();
  private readonly ownedPaths = new Set<string>();
  private disposed = false;

  constructor(private readonly slang: SlangModuleApi) {}

  public compile(request: SlangCompileRequest): SlangCompileResult {
    const result = this.compileTarget(request, "WGSL");
    if (!result.success) {
      return result;
    }
    return { success: true, wgsl: result.code, diagnostics: result.diagnostics };
  }

  public compileTarget(
    request: SlangCompileRequest,
    targetName: SlangCompileTargetName,
  ): SlangTargetCompileResult {
    if (this.disposed) {
      return failure("Slang compiler has been disposed", request.sourceUri);
    }
    const header = splitSlangRootHeader(request.source);
    const diagnostics = header.diagnostics.map((diagnostic) => diagnosticFor(
      diagnostic.message, request.sourceUri, diagnostic.line,
    ));
    if (diagnostics.length) {
      return { success: false, errors: diagnostics.map(({ message }) => message), diagnostics };
    }
    const fs = this.slang.FS;
    if (!fs) {
      return failure("Slang: WASM filesystem is unavailable", request.sourceUri, diagnostics);
    }
    try {
      syncWorkspaceToFileSystem(fs, request.workspace, this.ownedPaths);
    } catch (error) {
      return failure(errMessage(error), request.sourceUri, diagnostics);
    }

    let sessionHandles: SlangEmbindHandle[] = [];
    try {
      const { globalSession, target } = this.ensureGlobalSession(targetName);
      const session = globalSession.createSession(target);
      if (!session) {
        return this.lastFailure("Slang: failed to create session", request, diagnostics);
      }
      sessionHandles = [session];
      const moduleName = safeModuleName(request.options.passName ?? basename(request.sourcePath));
      const module = session.loadModuleFromSource(
        wrapSlangWorkspaceRoot(header.header, header.body, request.options), moduleName, request.sourcePath,
      );
      if (!module) {
        return this.lastFailure("Slang: failed to compile module", request, diagnostics);
      }
      sessionHandles.push(module);
      const vs = module.findEntryPointByName(SLANG_ENTRY_VERTEX);
      if (!vs) {
        return this.lastFailure("Slang: entry points not found (is `mainImage` defined?)", request, diagnostics);
      }
      sessionHandles.push(vs);
      const fragment = module.findEntryPointByName(SLANG_ENTRY_FRAGMENT);
      if (!fragment) {
        return this.lastFailure("Slang: entry points not found (is `mainImage` defined?)", request, diagnostics);
      }
      sessionHandles.push(fragment);
      const composite = session.createCompositeComponentType([module, vs, fragment]);
      if (!composite) {
        return this.lastFailure("Slang: failed to compose program", request, diagnostics);
      }
      sessionHandles.push(composite);
      const linked = composite.link();
      if (!linked) {
        return this.lastFailure("Slang: failed to link program", request, diagnostics);
      }
      sessionHandles.push(linked);
      const code = linked.getTargetCode(0);
      if (!code) {
        return this.lastFailure(`Slang: produced empty ${targetName}`, request, diagnostics);
      }
      return { success: true, target: targetName, code, diagnostics };
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
    this.disposed = true;
    if (this.slang.FS) {
      try {
        releaseWorkspaceFileSystem(this.slang.FS, this.ownedPaths);
      } catch { /* retained for retry-free disposal */ }
    }
    if (this.globalSession) {
      const global = this.globalSession;
      this.globalSession = null;
      this.targetValues.clear();
      deleteHandles([global]);
    }
  }

  private ensureGlobalSession(
    targetName: SlangCompileTargetName,
  ): { globalSession: SlangGlobalSession; target: number } {
    const cachedTarget = this.targetValues.get(targetName);
    if (this.globalSession && cachedTarget !== undefined) {
      return { globalSession: this.globalSession, target: cachedTarget };
    }
    const createdGlobalSession = !this.globalSession;
    const globalSession = this.globalSession ?? this.slang.createGlobalSession();
    if (!globalSession) {
      throw new Error("Slang: createGlobalSession returned null");
    }
    try {
      const targets = slangVectorToArray(this.slang.getCompileTargets());
      const requestedTarget = targets.find(
        (target) => target.name.toUpperCase() === targetName,
      );
      if (!requestedTarget) {
        throw new Error(`Slang: no ${targetName} compile target (available: ${targets.map((target) => target.name).join(", ") || "none"})`);
      }
      this.globalSession = globalSession;
      this.targetValues.set(targetName, requestedTarget.value);
      return { globalSession, target: requestedTarget.value };
    } catch (error) {
      if (createdGlobalSession) {
        deleteHandles([globalSession]);
      }
      throw error;
    }
  }

  private lastFailure(fallback: string, request: SlangCompileRequest, diagnostics: SlangDiagnostic[]): SlangCompileFailure {
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
    if (!unique.some((previous) => aliases(handle, previous))) {
      unique.push(handle);
    }
  }
  for (const handle of unique.reverse()) {
    try {
      handle.delete?.();
    } catch { /* cleanup must not replace a compiler result */ }
  }
}

function aliases(left: SlangEmbindHandle, right: SlangEmbindHandle): boolean {
  if (left === right) {
    return true;
  }
  try {
    if (left.isAliasOf?.(right)) {
      return true;
    }
  } catch { /* fall through */ }
  try {
    return right.isAliasOf?.(left) === true;
  } catch {
    return false;
  }
}

function failure(message: string, uri: string, diagnostics: SlangDiagnostic[] = []): SlangCompileFailure {
  return { success: false, errors: [message], diagnostics: diagnostics.length ? diagnostics : [diagnosticFor(message, uri)] };
}

function diagnosticFor(message: string, uri: string, line = 0, character = 0, code?: string): SlangDiagnostic {
  return { severity: "error", message, source: "slang-compile", uri, range: { start: { line, character }, end: { line, character } }, ...(code ? { code } : {}) };
}

function parseDiagnostics(message: string, workspace: SlangWorkspaceSnapshot, fallbackUri: string): SlangDiagnostic[] {
  const normalized = message.replace(/\r\n?|\n/g, "\n");
  const matcher = /^(error|warning|note|info)(?:\[([^\]]+)\])?:\s*([^\n]+)\n\s*-->\s*(\/workspace\/[^:\n]+):(\d+):(\d+)\s*$/gim;
  const diagnostics: SlangDiagnostic[] = [];
  for (const match of normalized.matchAll(matcher)) {
    const file = workspace.files.find(({ path }) => path === match[4]);
    const severity = diagnosticSeverity(match[1]);
    if (!file) {
      diagnostics.push({ ...diagnosticFor(match[0], fallbackUri), severity }); continue;
    }
    diagnostics.push({ ...diagnosticFor(match[3], file.uri, Math.max(0, Number(match[5]) - 1), Math.max(0, Number(match[6]) - 1), match[2]), severity });
  }
  return diagnostics.length ? diagnostics : [diagnosticFor(message, fallbackUri)];
}

function diagnosticSeverity(value: string): SlangDiagnostic["severity"] {
  return value.toLowerCase() === "warning" ? "warning" : value.toLowerCase() === "error" ? "error" : "information";
}

function basename(path: string): string {
  const segments = path.split("/");
  return (segments[segments.length - 1] || "image").replace(/\.slang$/i, "");
}
function safeModuleName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "image";
}
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

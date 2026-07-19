import {
  normalizeInternalPath,
  syncWorkspaceToFileSystem,
  type SlangDiagnostic,
  type SlangWorkspaceSnapshot,
} from "@shader-studio/slang-language-service";
import {
  type SlangModuleApi,
  type SlangGlobalSession,
  slangVectorToArray,
} from "./slangTypes";
import {
  wrapSlangImageSource,
  SLANG_ENTRY_VERTEX,
  SLANG_ENTRY_FRAGMENT,
  type SlangWrapOptions,
} from "./SlangPrelude";

export type SlangCompileResult =
  | { success: true; wgsl: string; diagnostics: SlangDiagnostic[] }
  | { success: false; errors: string[]; diagnostics: SlangDiagnostic[] };

export type SlangCompileOptions = SlangWrapOptions;

export interface SlangCompileRequest {
  source: string;
  sourceUri: string;
  sourcePath: string;
  workspace: SlangWorkspaceSnapshot;
  options: SlangCompileOptions;
}

/**
 * Compiles user `.slang` image-shader source to WGSL via slang-wasm.
 *
 * The expensive global session (loads the Slang stdlib) is created once and
 * cached. A fresh per-compile session avoids module-name collisions across
 * recompiles. The slang module is injected so this is unit-testable with a fake.
 */
export class SlangCompiler {
  private globalSession: SlangGlobalSession | null = null;
  private wgslTargetValue: number | null = null;
  private readonly mountedPaths = new Set<string>();

  constructor(private slang: SlangModuleApi) {}

  public compile(request: SlangCompileRequest): SlangCompileResult {
    try {
      syncWorkspaceToFileSystem(
        this.slang.FS,
        request.workspace,
        new Map(),
        this.mountedPaths,
      );
    } catch (error) {
      return this.failure(errMessage(error), request);
    }

    let globalSession: SlangGlobalSession;
    let target: number;
    try {
      ({ globalSession, target } = this.ensureGlobalSession());
    } catch (error) {
      return this.failure(errMessage(error), request);
    }

    const session = globalSession.createSession(target);
    if (!session) {
      return this.failure(this.lastError("Slang: failed to create session"), request);
    }

    let sourcePath: string;
    try {
      sourcePath = normalizeInternalPath(request.sourcePath);
    } catch (error) {
      return this.failure(errMessage(error), request);
    }
    const wrapped = wrapSlangImageSource(request.source, request.options);
    const moduleName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") || "image";
    const module = session.loadModuleFromSource(wrapped, moduleName, sourcePath);
    if (!module) {
      return this.failure(this.lastError("Slang: failed to compile module"), request);
    }

    const vs = module.findEntryPointByName(SLANG_ENTRY_VERTEX);
    const fs = module.findEntryPointByName(SLANG_ENTRY_FRAGMENT);
    if (!vs || !fs) {
      return this.failure("Slang: entry points not found (is `mainImage` defined?)", request);
    }

    const composite = session.createCompositeComponentType([module, vs, fs]);
    if (!composite) {
      return this.failure(this.lastError("Slang: failed to compose program"), request);
    }

    const linked = composite.link();
    if (!linked) {
      return this.failure(this.lastError("Slang: failed to link program"), request);
    }

    const wgsl = linked.getTargetCode(0);
    if (!wgsl) {
      return this.failure(this.lastError("Slang: produced empty WGSL"), request);
    }

    return { success: true, wgsl, diagnostics: [] };
  }

  private ensureGlobalSession(): { globalSession: SlangGlobalSession; target: number } {
    if (this.globalSession && this.wgslTargetValue !== null) {
      return { globalSession: this.globalSession, target: this.wgslTargetValue };
    }

    const globalSession = this.slang.createGlobalSession();
    if (!globalSession) {
      throw new Error("Slang: createGlobalSession returned null");
    }

    const targets = slangVectorToArray(this.slang.getCompileTargets());
    const wgsl = targets.find((t) => /wgsl/i.test(t.name));
    if (!wgsl) {
      throw new Error(
        `Slang: no WGSL compile target (available: ${targets.map((t) => t.name).join(", ") || "none"})`,
      );
    }

    this.globalSession = globalSession;
    this.wgslTargetValue = wgsl.value;
    return { globalSession, target: wgsl.value };
  }

  private lastError(fallback: string): string {
    const msg = this.slang.getLastError?.()?.message?.trim();
    return msg && msg.length > 0 ? msg : fallback;
  }

  private failure(message: string, request: SlangCompileRequest): SlangCompileResult {
    return {
      success: false,
      errors: [message],
      diagnostics: parseSlangDiagnostics(message, request),
    };
  }
}

const DIAGNOSTIC_ENVELOPE = /^(.*?)\((\d+),(\d+)\):\s*(error|warning|note|info)(?:\s+([A-Za-z]?\d+))?\s*:\s*(.*)$/;
const MODERN_DIAGNOSTIC_HEADER = /^(error|warning|note|info)(?:\[([^\]]+)\])?:\s*(.*)$/;
const MODERN_DIAGNOSTIC_LOCATION = /^\s*-->\s+(.+):(\d+):(\d+)\s*$/;

export function parseSlangDiagnostics(
  raw: string,
  request: Pick<SlangCompileRequest, "sourceUri" | "workspace" | "options">,
): SlangDiagnostic[] {
  const uriByPath = new Map<string, string>();
  for (const file of request.workspace.files) {
    try {
      uriByPath.set(normalizeInternalPath(file.path), file.uri);
    } catch {
      // A malformed snapshot is reported against the root request rather than
      // allowing diagnostic formatting itself to throw.
    }
  }
  const diagnostics: SlangDiagnostic[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const modernHeader = MODERN_DIAGNOSTIC_HEADER.exec(line);
    const modernLocation = modernHeader ? MODERN_DIAGNOSTIC_LOCATION.exec(lines[index + 1] ?? "") : null;
    if (modernHeader && modernLocation) {
      diagnostics.push(createDiagnostic(
        modernLocation[1],
        modernLocation[2],
        modernLocation[3],
        modernHeader[1],
        modernHeader[2],
        modernHeader[3],
        uriByPath,
        request,
      ));
      index += 1;
      continue;
    }
    const match = DIAGNOSTIC_ENVELOPE.exec(line);
    if (!match) {
      continue;
    }
    diagnostics.push(createDiagnostic(
      match[1],
      match[2],
      match[3],
      match[4],
      match[5],
      match[6],
      uriByPath,
      request,
    ));
  }
  if (diagnostics.length > 0) {
    return diagnostics;
  }
  return [{
    uri: request.sourceUri,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    severity: "error",
    message: raw,
    source: "slang-compile",
    ...(request.options.passName ? { passName: request.options.passName } : {}),
  }];
}

function createDiagnostic(
  rawPath: string,
  rawLine: string,
  rawCharacter: string,
  rawSeverity: string,
  code: string | undefined,
  message: string,
  uriByPath: ReadonlyMap<string, string>,
  request: Pick<SlangCompileRequest, "sourceUri" | "options">,
): SlangDiagnostic {
  let path: string | undefined;
  try {
    path = normalizeInternalPath(rawPath);
  } catch {
    path = undefined;
  }
  const line = Math.max(0, Number(rawLine) - 1);
  const character = Math.max(0, Number(rawCharacter) - 1);
  const severity = rawSeverity === "warning"
    ? "warning" as const
    : rawSeverity === "note" || rawSeverity === "info"
      ? "information" as const
      : "error" as const;
  return {
    uri: path ? uriByPath.get(path) ?? request.sourceUri : request.sourceUri,
    range: { start: { line, character }, end: { line, character } },
    severity,
    ...(code ? { code } : {}),
    message,
    source: "slang-compile",
    ...(request.options.passName ? { passName: request.options.passName } : {}),
  };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

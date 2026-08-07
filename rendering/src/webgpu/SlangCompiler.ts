import {
  type SlangModuleApi,
  type SlangGlobalSession,
  type SlangModule,
  type SlangCompileOptions,
  slangVectorToArray,
} from "./slangTypes";
import {
  wrapSlangComputeSource,
  wrapSlangImageSource,
  getNativeComputeEntryPoints,
  stripShaderStudioEditorImport,
  SLANG_ENTRY_VERTEX,
  SLANG_ENTRY_FRAGMENT,
} from "./SlangPrelude";

export type SlangCompileResult =
  | { success: true; wgsl: string }
  | { success: false; errors: string[] };

export type { SlangCompileOptions } from "./slangTypes";

/**
 * Compiles user `.slang` render or compute source to WGSL via slang-wasm.
 *
 * The expensive global session (loads the Slang stdlib) is created once and
 * cached. A fresh per-compile session avoids module-name collisions across
 * recompiles. The slang module is injected so this is unit-testable with a fake.
 */
export class SlangCompiler {
  private globalSession: SlangGlobalSession | null = null;
  private wgslTargetValue: number | null = null;

  constructor(private slang: SlangModuleApi) {}

  /** Compile one pass. Never throws — failures come back as errors. */
  public compileImagePass(
    userSource: string,
    options: SlangCompileOptions = {},
  ): SlangCompileResult {
    let globalSession: SlangGlobalSession;
    let target: number;
    try {
      ({ globalSession, target } = this.ensureGlobalSession());
    } catch (e) {
      return { success: false, errors: [errMessage(e)] };
    }

    const session = globalSession.createSession(target);
    if (!session) {
      return { success: false, errors: [this.lastError("Slang: failed to create session")] };
    }

    const dependencyModules: SlangModule[] = [];
    for (const dependency of options.modules ?? []) {
      const dependencyModule = session.loadModuleFromSource(
        stripShaderStudioEditorImport(dependency.source),
        dependency.moduleName,
        dependency.path,
      );
      if (!dependencyModule) {
        return { success: false, errors: [this.lastError(
          `Slang: failed to compile imported module ${dependency.moduleName} (${dependency.path})`,
        )] };
      }
      dependencyModules.push(dependencyModule);
    }

    // Strip import statements before passing source to the Slang WASM
    // runtime. The WASM has no filesystem, so any form of `import` (quoted
    // path or dotted identifier) triggers "cannot open file". Dependencies
    // are pre-loaded above and linked via the composite below.
    const resolvedSource = stripImports(userSource);

    const isCompute = options.passKind === "compute";
    const nativeComputeEntryPoints = isCompute ? getNativeComputeEntryPoints(resolvedSource) : [];
    const computeEntryPoint = options.entryPoint
      ? nativeComputeEntryPoints.find(({ name }) => name === options.entryPoint)?.name
      : nativeComputeEntryPoints.length === 1 ? nativeComputeEntryPoints[0]!.name : undefined;
    if (isCompute && !computeEntryPoint) {
      return {
        success: false,
        errors: ['Slang: compute source must declare a native `[shader("compute")]` entry point'],
      };
    }
    const wrapped = isCompute
      ? wrapSlangComputeSource(resolvedSource, {
        passName: options.passName,
        commonCode: options.commonCode,
        channels: options.channels,
        storage: options.storage,
        workgroupSize: options.workgroupSize ?? [8, 8, 1],
        outputLayers: options.outputLayers ?? 1,
        hasOutput: options.hasOutput === true,
        customUniforms: options.customUniforms,
        outputImageFormat: options.outputImageFormat ?? "rgba16f",
      })
      : wrapSlangImageSource(resolvedSource, {
        passName: options.passName,
        commonCode: options.commonCode,
        channels: options.channels,
        storage: options.storage,
        passKind: options.passKind ?? "render",
        geometry: options.geometry,
        vertexCode: options.vertexCode,
        captureMode: options.captureMode,
        customUniforms: options.customUniforms,
      });
    // Name the module after the pass so Slang diagnostics cite the right
    // file (e.g. /buffera.slang) rather than always claiming /image.slang.
    const sourceWithoutComments = resolvedSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const declaredModuleName = sourceWithoutComments.match(
      /^\s*module\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m,
    )?.[1];
    const moduleName = declaredModuleName ?? (options.passName ?? "image").toLowerCase();
    const modulePath = options.sourcePath ?? `/${moduleName}.slang`;
    const module = session.loadModuleFromSource(wrapped, moduleName, modulePath);
    if (!module) {
      const error = this.lastError("Slang: failed to compile module");
      return {
        success: false,
        errors: [isMissingMainImageDiagnostic(error)
          ? "Missing mainImage function"
          : error],
      };
    }

    const entryPointNames = isCompute
      ? [computeEntryPoint!]
      : [SLANG_ENTRY_VERTEX, SLANG_ENTRY_FRAGMENT];
    const entryPoints = entryPointNames.map((name) => module.findEntryPointByName(name));
    if (entryPoints.some((entryPoint) => !entryPoint)) {
      return {
        success: false,
        errors: [isCompute
          ? "Slang: configured native compute entry point was not found"
          : "Slang: entry points not found (is `mainImage` defined?)"],
      };
    }

    const composite = session.createCompositeComponentType([...dependencyModules, module, ...entryPoints]);
    if (!composite) {
      return { success: false, errors: [this.lastError("Slang: failed to compose program")] };
    }

    const linked = composite.link();
    if (!linked) {
      return { success: false, errors: [this.lastError("Slang: failed to link program")] };
    }

    const wgsl = linked.getTargetCode(0);
    if (!wgsl) {
      return { success: false, errors: [this.lastError("Slang: produced empty WGSL")] };
    }

    return { success: true, wgsl };
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
}

const IMPORT_STRIP_PATTERN = /^[ \t]*import[ \t]+((?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|"[^"]+")[ \t]*;?[ \t]*$/gm;

/**
 * Strip import declarations from Slang source before passing it to the WASM
 * runtime. The WASM has no filesystem, so any form of `import` triggers
 * "cannot open file". Dependencies are pre-loaded as separate modules and
 * linked via the composite.
 *
 * The `shader_studio` editor import is left intact — it is handled separately
 * by `stripShaderStudioEditorImport` which replaces it with a line-preserving
 * comment inside the wrap functions.
 */
function stripImports(source: string): string {
  return source.replace(IMPORT_STRIP_PATTERN, (_match, target: string) => {
    if (target === "shader_studio" || target === '"shader-studio.slang"') {
      return _match; // leave for stripShaderStudioEditorImport
    }
    return "";
  });
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isMissingMainImageDiagnostic(error: string): boolean {
  return /undefined identifier[\s\S]*['"]mainImage['"]/i.test(error);
}

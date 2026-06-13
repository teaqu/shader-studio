import {
  type SlangModuleApi,
  type SlangGlobalSession,
  slangVectorToArray,
} from "./slangTypes";
import {
  wrapSlangImageSource,
  SLANG_ENTRY_VERTEX,
  SLANG_ENTRY_FRAGMENT,
} from "./SlangPrelude";

export type SlangCompileResult =
  | { success: true; wgsl: string }
  | { success: false; errors: string[] };

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

  constructor(private slang: SlangModuleApi) {}

  /** Compile a single image pass. Never throws — failures come back as errors. */
  public compileImagePass(userSource: string): SlangCompileResult {
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

    const wrapped = wrapSlangImageSource(userSource);
    const module = session.loadModuleFromSource(wrapped, "image", "/image.slang");
    if (!module) {
      return { success: false, errors: [this.lastError("Slang: failed to compile module")] };
    }

    const vs = module.findEntryPointByName(SLANG_ENTRY_VERTEX);
    const fs = module.findEntryPointByName(SLANG_ENTRY_FRAGMENT);
    if (!vs || !fs) {
      return {
        success: false,
        errors: ["Slang: entry points not found (is `mainImage` defined?)"],
      };
    }

    const composite = session.createCompositeComponentType([module, vs, fs]);
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

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

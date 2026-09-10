import { GLSL_EXTENSIONS, SLANG_EXTENSIONS, WGSL_EXTENSIONS } from "../assetExtensions";

/** Every shader language the studio can open. Widen this union to add a language. */
export type ShaderLanguageId = "glsl" | "slang" | "wgsl";

export interface ShaderLanguageDescriptor {
  id: ShaderLanguageId;
  /** File extensions, no leading dot. First entry is the canonical one. */
  extensions: readonly string[];
  /** Which rendering engine implements it. */
  engine: "webgl" | "webgpu";
  /** Monaco language id registered by the monaco package. */
  monacoId: string;
  /** Whether a language service exists for it. */
  hasLanguageService: boolean;
  /** Whether the step debugger / variable inspector supports it. */
  hasDebugger: boolean;
  /**
   * Whether debugging flows through a DebugInstrumentationPlan (Slang, WGSL)
   * rather than GLSL-style source rewriting. GLSL debugs without a plan.
   */
  hasDebugPlan: boolean;
  /** Whether multi-file imports are supported. */
  hasImports: boolean;
  /** Display name for UI. */
  label: string;
}

export const SHADER_LANGUAGES: Readonly<Record<ShaderLanguageId, ShaderLanguageDescriptor>> = {
  glsl: {
    id: "glsl",
    extensions: GLSL_EXTENSIONS,
    engine: "webgl",
    monacoId: "glsl",
    hasLanguageService: true,
    hasDebugger: true,
    hasDebugPlan: false,
    hasImports: false,
    label: "GLSL",
  },
  slang: {
    id: "slang",
    extensions: SLANG_EXTENSIONS,
    engine: "webgpu",
    monacoId: "slang",
    hasLanguageService: true,
    hasDebugger: true,
    hasDebugPlan: true,
    hasImports: true,
    label: "Slang",
  },
  wgsl: {
    id: "wgsl",
    extensions: WGSL_EXTENSIONS,
    engine: "webgpu",
    monacoId: "wgsl",
    hasLanguageService: true,
    hasDebugger: true,
    hasDebugPlan: true,
    hasImports: false,
    label: "WGSL",
  },
};

const SHADER_LANGUAGE_IDS: readonly ShaderLanguageId[] = ["glsl", "slang", "wgsl"];

export function isShaderLanguageId(value: string): value is ShaderLanguageId {
  return (SHADER_LANGUAGE_IDS as readonly string[]).includes(value);
}

/** Resolves a shader language from a file path's extension (case-insensitive). */
export function shaderLanguageForPath(path: string): ShaderLanguageId | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  const extension = path.slice(dot + 1).toLowerCase();
  if (extension === "") {
    return null;
  }
  for (const id of SHADER_LANGUAGE_IDS) {
    if (SHADER_LANGUAGES[id].extensions.some((candidate) => candidate.toLowerCase() === extension)) {
      return id;
    }
  }
  return null;
}

/** Accepts an untrusted language string, falling back to GLSL for anything unknown. */
export function shaderLanguageOrDefault(value: string | undefined): ShaderLanguageId {
  return value !== undefined && isShaderLanguageId(value) ? value : "glsl";
}

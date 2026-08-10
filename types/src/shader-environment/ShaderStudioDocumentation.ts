import { SHADER_STUDIO_BUILTIN_UNIFORMS } from "./BuiltinUniforms";

export interface ShaderStudioSymbolDocumentation {
  name: string;
  glslType?: string;
  slangType: string;
  languages: readonly ("glsl" | "slang")[];
  description: string;
}

/** Documentation consumed by editors for every built-in Shader Studio symbol. */
export const SHADER_STUDIO_SYMBOL_DOCS: readonly ShaderStudioSymbolDocumentation[] =
  SHADER_STUDIO_BUILTIN_UNIFORMS;

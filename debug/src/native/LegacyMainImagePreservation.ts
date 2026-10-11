import { getShaderSourceFunctions, tokenizeShaderSource } from "@shader-studio/types";
import type { DebugSourceEdit, ShaderLanguageId } from "@shader-studio/types";

/** Renames a co-located legacy hook so native/compute debug wrappers can coexist. */
export function preserveLegacyMainImage(source: string, language: ShaderLanguageId, prefix: string): DebugSourceEdit[] {
  if (!getShaderSourceFunctions(source, language).some((fn) => fn.name === "mainImage" && fn.stage === undefined)) {
    return [];
  }
  return tokenizeShaderSource(source).filter((token) => token.kind === "identifier" && token.text === "mainImage")
    .map((token) => ({ start: token.start, end: token.end, text: `${prefix}_legacyMainImage` }));
}

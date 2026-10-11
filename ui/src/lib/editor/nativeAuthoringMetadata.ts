import { getShaderEntryPoints, type ShaderLanguageId } from "@shader-studio/types";

/** Metadata the authoring environment needs when a source contains multiple native stages. */
export function nativeAuthoringMetadata(source: string, language: ShaderLanguageId): { storageWritable?: boolean } {
  if (language !== "slang") {
    return {};
  }
  return getShaderEntryPoints(source, language).some((entry) => entry.stage === "compute")
    ? { storageWritable: true }
    : {};
}

import { getShaderEntryPoints, type ShaderConfig, type ShaderLanguageId } from "@shader-studio/types";

/**
 * Identifies a sibling-configured native render root without treating ordinary
 * native helpers or compute-only sources as independently previewable shaders.
 * A configured `Image.entryPoints` deliberately wins even when malformed so
 * the normal project compiler can report the configuration error.
 */
export function isConfiguredNativeRenderRoot(
  source: string,
  language: ShaderLanguageId,
  config: ShaderConfig | null,
  hasSiblingConfig: boolean,
): boolean {
  if (!hasSiblingConfig || language === "glsl") {
    return false;
  }
  const image = config?.passes?.Image;
  if (image && typeof image === "object" && "entryPoints" in image) {
    return true;
  }
  const entries = getShaderEntryPoints(source, language);
  return entries.filter(({ stage }) => stage === "vertex").length === 1
    && entries.filter(({ stage }) => stage === "fragment").length === 1;
}

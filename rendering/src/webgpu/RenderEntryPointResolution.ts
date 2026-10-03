import { getShaderEntryPoints, type ShaderConfig, type ShaderLanguageId } from "@shader-studio/types";

/** Resolve native render stages before compilation so wrappers retain hook mode
 * unless a valid render entry-point object explicitly opts into native mode. */
export function resolveRenderEntryPoints(
  passName: string,
  pass: ShaderConfig["passes"][string],
  source: string,
  language: ShaderLanguageId,
  errors: string[],
): { vertex: string; fragment: string } | undefined | null {
  if (!pass || !("entryPoints" in pass) || pass.entryPoints === undefined) {
    return undefined;
  }
  const configured = pass.entryPoints;
  if (!isRecord(configured) || Array.isArray(configured) || Object.entries(configured).some(([stage, name]) =>
    !["vertex", "fragment"].includes(stage) || typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    errors.push(`${passName}: entryPoints must be a render object with optional vertex and fragment names`);
    return null;
  }
  const entries = getShaderEntryPoints(source, language);
  const renderConfigured = configured as { vertex?: string; fragment?: string };
  const resolve = (stage: "vertex" | "fragment"): string | undefined => {
    const requested = renderConfigured[stage];
    const candidates = entries.filter((entry) => entry.stage === stage);
    if (requested) {
      if (candidates.some((entry) => entry.name === requested)) {
        return requested;
      }
      errors.push(`${passName}: ${stage} entry point "${requested}" was not found in its source`);
      return undefined;
    }
    if (candidates.length === 1) {
      return candidates[0]!.name;
    }
    const stageAnnotation = language === "wgsl" ? `@${stage}` : `[shader("${stage}")]`;
    errors.push(candidates.length === 0
      ? `${passName}: native render source must declare a ${stageAnnotation} entry point`
      : `${passName}: source has multiple ${stageAnnotation} entry points; select one in the config UI`);
    return undefined;
  };
  const vertex = resolve("vertex");
  const fragment = resolve("fragment");
  return vertex && fragment ? { vertex, fragment } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import { getShaderEntryPoints, type ShaderConfig, type ShaderLanguageId } from "@shader-studio/types";

/** Resolve native render stages before compilation so wrappers retain hook mode
 * unless a valid render entry-point object explicitly opts into native mode. */
export function resolveRenderEntryPoints(
  passName: string,
  pass: ShaderConfig["passes"][string],
  source: string,
  language: ShaderLanguageId,
  errors: string[],
): { vertex?: string; fragment?: string } | undefined | null {
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
  const initialErrorCount = errors.length;
  const resolved: { vertex?: string; fragment?: string } = {};
  for (const stage of ["vertex", "fragment"] as const) {
    const requested = (configured as { vertex?: string; fragment?: string })[stage];
    if (!requested) {
      continue;
    }
    if (entries.some(entry => entry.stage === stage && entry.name === requested)) {
      resolved[stage] = requested;
    } else {
      errors.push(`${passName}: ${stage} entry point "${requested}" was not found in its source`);
    }
  }
  return errors.length > initialErrorCount ? null : resolved;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

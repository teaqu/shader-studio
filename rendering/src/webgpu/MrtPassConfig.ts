import type { ShaderConfig, ShaderLanguageId } from "@shader-studio/types";

type PassEntry = [string, ShaderConfig["passes"][string]];

export interface RenderOutputConfig {
  count: number;
  outputs?: { name?: string }[];
}

/** Validates explicit render output lists before graph routing consumes them. */
export function resolveRenderOutputs(
  passEntries: readonly PassEntry[],
  language: ShaderLanguageId,
  errors: string[],
): ReadonlyMap<string, RenderOutputConfig> {
  const result = new Map<string, RenderOutputConfig>();
  for (const [name, pass] of passEntries) {
    const candidate = pass as { type?: unknown; outputs?: unknown; entryPoints?: unknown; vertex?: unknown } | undefined;
    if (candidate?.outputs === undefined) {
      continue;
    }
    if (name === "Image") {
      errors.push("Image: multiple render targets are supported only on buffer passes");
      continue;
    }
    if (candidate.type === "compute") {
      errors.push(`${name}: compute passes use outputLayers; render outputs are not supported`);
      continue;
    }
    if (!isValidOutputList(candidate.outputs)) {
      errors.push(`${name}: outputs must be a non-empty list of at most 8 named render targets`);
      continue;
    }
    const outputs = candidate.outputs;
    if (outputs.length > 1) {
      if (language === "glsl") {
        errors.push(`${name}: multiple render targets require native WGSL or Slang entry points; GLSL MRT is not supported yet`);
        continue;
      }
      if (candidate.entryPoints === undefined) {
        errors.push(`${name}: multiple render targets require native render entryPoints`);
        continue;
      }
    }
    result.set(name, {
      count: outputs.length,
      ...(outputs.some((output) => output.name !== undefined) ? { outputs } : {}),
    });
  }
  return result;
}

function isValidOutputList(value: unknown): value is { name?: string }[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 8
    && value.every((output) => isOutputDefinition(output));
}

function isOutputDefinition(value: unknown): value is { name?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const output = value as Record<string, unknown>;
  const keys = Object.keys(output);
  return keys.every((key) => key === "name")
    && (output.name === undefined || (typeof output.name === "string" && output.name.trim().length > 0));
}

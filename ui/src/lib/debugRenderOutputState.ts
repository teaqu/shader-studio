import { getShaderOutputs, type ShaderConfig, type ShaderLanguageId } from "@shader-studio/types";

export interface RenderOutputDebugState {
  renderOutput?: number;
  renderOutputs?: string[];
}

/** Labels and clamps the temporary display attachment without changing config. */
export function resolveRenderOutputState(
  pass: ShaderConfig["passes"][string] | undefined,
  selectedOutput: number | undefined,
  source?: string,
  language: ShaderLanguageId = 'glsl',
): Required<RenderOutputDebugState> {
  const legacy = pass && "outputs" in pass && Array.isArray(pass.outputs) && pass.outputs.length > 0
    ? pass.outputs
    : [{}];
  const entryPoints = pass && 'entryPoints' in pass ? pass.entryPoints : undefined;
  const outputs = source === undefined ? legacy : getShaderOutputs(source, language, entryPoints && 'fragment' in entryPoints ? entryPoints.fragment : undefined).outputs
    .map(output => ({ name: legacy[output.slot]?.name ?? output.name }));
  const renderOutputs = outputs.map((output, index) => output.name ? `Output ${index} (${output.name})` : `Output ${index}`);
  return { renderOutput: Math.max(0, Math.min(selectedOutput ?? 0, renderOutputs.length - 1)), renderOutputs };
}

import type { ShaderConfig } from "@shader-studio/types";

export interface RenderOutputDebugState {
  renderOutput?: number;
  renderOutputs?: string[];
}

/** Labels and clamps the temporary display attachment without changing config. */
export function resolveRenderOutputState(
  pass: ShaderConfig["passes"][string] | undefined,
  selectedOutput: number | undefined,
): Required<RenderOutputDebugState> {
  const outputs = pass && "outputs" in pass && Array.isArray(pass.outputs) && pass.outputs.length > 0
    ? pass.outputs
    : [{}];
  const renderOutputs = outputs.map((output, index) => output.name ? `Output ${index} (${output.name})` : `Output ${index}`);
  return { renderOutput: Math.max(0, Math.min(selectedOutput ?? 0, renderOutputs.length - 1)), renderOutputs };
}

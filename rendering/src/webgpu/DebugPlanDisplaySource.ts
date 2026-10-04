import { projectNativeRasterDisplay } from "@shader-studio/debug/native/NativeRasterDisplay";
import type { DebugInstrumentationPlan, DebugSourceUnit, ShaderConfig, ShaderLanguageId } from "@shader-studio/types";
import { getShaderOutputs } from "@shader-studio/types";

/** Buffer debug plans display one attachment on the canvas, leaving the plan intact for capture. */
export function debugPlanDisplaySource(
  root: DebugSourceUnit, plan: DebugInstrumentationPlan, config: ShaderConfig | null | undefined, language: ShaderLanguageId,
): { source: string; config: ShaderConfig | null | undefined } | string {
  const image = config?.passes.Image as (ShaderConfig["passes"]["Image"] & { outputs?: { name?: string }[] }) | undefined;
  const count = getShaderOutputs(root.source, language, plan.nativeRender?.fragmentEntryPoint).outputs.length;
  if (!plan.nativeRender || count <= 1) {
    return { source: root.source, config };
  }
  const source = projectNativeRasterDisplay(root.source, language, plan.nativeRender.fragmentEntryPoint, plan.nativeRender.output ?? 0);
  if (source === null) {
    return "The selected native render output could not be projected for display.";
  }
  if (!config || !image?.outputs) {
    return { source, config };
  }
  const { outputs: _outputs, ...displayImage } = image;
  return { source, config: { ...config, passes: { ...config.passes, Image: displayImage } } };
}

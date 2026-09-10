import type { DebugPreviewOptions } from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { parseWgslDocument } from "@shader-studio/wgsl-analysis";
import { applyWgslPreviewPostProcessing } from "./WgslInstrumentationPlanner";
import { offsetAt } from "./model";

/**
 * Applies normalize/step post-processing to the full WGSL shader output when
 * no inline line preview is active: the user's `mainImage` is renamed and a
 * fresh entry post-processes its color.
 */
export function applyWgslFullShaderPostProcessing(
  source: string,
  options: DebugPreviewOptions,
): string | null {
  if (options.normalizeMode === "off" && options.stepEdge === null) return null;
  const document = parseWgslDocument("/shader-studio/full-preview.wgsl", source, "fragment");
  const mainImage = document.symbols.find((symbol) => symbol.kind === "function"
    && symbol.name === "mainImage"
    && (symbol.typeName === "vec4f" || symbol.typeName === "vec4<f32>"));
  if (!mainImage) return null;

  const originalName = "_ssdbg_full_userMain";
  const color = applyWgslPreviewPostProcessing(`${originalName}(coord)`, options);
  const wrapper = `\nfn mainImage(coord: vec2f) -> vec4f {\n  return ${color};\n}\n`;
  const nameStart = offsetAt(source, mainImage.declaration.start);
  const nameEnd = offsetAt(source, mainImage.declaration.end);
  const applied = applySourceEdits(source, [
    { start: nameStart, end: nameEnd, text: originalName },
    { start: source.length, end: source.length, text: wrapper },
  ]);
  return applied.ok ? applied.source : null;
}

import type { DebugPreviewOptions } from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { applySlangPreviewPostProcessing } from "./SlangInstrumentationPlanner";
import { createSlangWorkspace } from "./SlangWorkspace";
import { buildNativeRasterReplay } from "../native/NativeRasterReplay";

export function applySlangFullShaderPostProcessing(
  source: string,
  options: DebugPreviewOptions,
  entryPoint?: string | null,
): string | null {
  if (options.normalizeMode === "off" && options.stepEdge === null) {
    return null;
  }
  if (entryPoint === null) {
    return null;
  }
  if (entryPoint !== undefined) {
    return applyNativeSlangFullShaderPostProcessing(source, options, entryPoint);
  }
  const path = "/shader-studio/full-preview.slang";
  const created = createSlangWorkspace({
    rootUri: path,
    rootPath: path,
    passName: "Image",
    contentHash: "full0000",
    files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }],
  });
  if (!created.ok) {
    return null;
  }
  const file = created.workspace.filesByUri.get(created.workspace.rootUri);
  const mainImage = file && [...file.structure.callables.values()]
    .find((callable) => callable.kind === "free" && callable.name === "mainImage");
  if (!mainImage || mainImage.returnTypeName !== "float4") {
    return null;
  }

  const originalName = "_ssdbg_full_userMain";
  const color = applySlangPreviewPostProcessing(`${originalName}(fragCoord)`, options);
  const wrapper = `\nfloat4 mainImage(float2 fragCoord)\n{\n  return ${color};\n}\n`;
  const applied = applySourceEdits(source, [
    { start: mainImage.nameToken.startOffset, end: mainImage.nameToken.endOffset, text: originalName },
    { start: source.length, end: source.length, text: wrapper },
  ]);
  return applied.ok ? applied.source : null;
}

function applyNativeSlangFullShaderPostProcessing(source: string, options: DebugPreviewOptions, entryPoint: string): string | null {
  const replay = buildNativeRasterReplay(source, "slang", entryPoint, "_ssdbg_full", options.output ?? 0);
  if (typeof replay === "string") {
    return null;
  }
  const color = applySlangPreviewPostProcessing(replay.colorExpression("result"), options);
  const wrapper = `\n${replay.wrapperHeader}{\n  ${replay.returnType} result = ${replay.call};\n  ${replay.returnColor("result", color)}\n}\n`;
  const applied = applySourceEdits(source, [
    ...replay.edits,
    { start: source.length, end: source.length, text: wrapper },
  ]);
  return applied.ok ? applied.source : null;
}

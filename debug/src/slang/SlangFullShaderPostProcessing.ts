import type { DebugPreviewOptions } from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { applySlangPreviewPostProcessing } from "./SlangInstrumentationPlanner";
import { createSlangWorkspace } from "./SlangWorkspace";

export function applySlangFullShaderPostProcessing(
  source: string,
  options: DebugPreviewOptions,
): string | null {
  if (options.normalizeMode === "off" && options.stepEdge === null) return null;
  const path = "/shader-studio/full-preview.slang";
  const created = createSlangWorkspace({
    rootUri: path,
    rootPath: path,
    passName: "Image",
    contentHash: "full0000",
    files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }],
  });
  if (!created.ok) return null;
  const file = created.workspace.filesByUri.get(created.workspace.rootUri);
  const mainImage = file && [...file.structure.callables.values()]
    .find((callable) => callable.kind === "free" && callable.name === "mainImage");
  if (!mainImage || mainImage.returnTypeName !== "float4") return null;

  const originalName = "_ssdbg_full_userMain";
  const color = applySlangPreviewPostProcessing(`${originalName}(fragCoord)`, options);
  const wrapper = `\nfloat4 mainImage(float2 fragCoord)\n{\n  return ${color};\n}\n`;
  const applied = applySourceEdits(source, [
    { start: mainImage.nameToken.startOffset, end: mainImage.nameToken.endOffset, text: originalName },
    { start: source.length, end: source.length, text: wrapper },
  ]);
  return applied.ok ? applied.source : null;
}

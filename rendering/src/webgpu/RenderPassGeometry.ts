import type { RenderPassSettings, ShaderLanguageId } from "@shader-studio/types";
import type { RenderPassChannel, RenderPassNode } from "../types/PassGraph";
import { resolvePassGeometry, type VerticesDrawConfig, type InstanceDrawConfig } from "../types/Geometry";

export function createImagePass(
  source: string,
  width: number,
  height: number,
  channels: RenderPassChannel[],
  geometry: ReturnType<typeof resolvePassGeometry>,
  vertexSrc?: string,
  meshSettings: { modelPath?: string; modelMesh?: string; useViewerCamera?: boolean } = {},
  language: ShaderLanguageId = "slang",
  drawSettings: VerticesDrawConfig & InstanceDrawConfig & RenderPassSettings = {},
): RenderPassNode {
  return {
    name: "Image",
    source,
    language,
    geometry,
    ...meshSettings,
    ...drawSettings,
    vertexSrc,
    kind: "render",
    output: "canvas",
    outputLayers: 1,
    dispatchCount: 1,
    dispatchOnce: false,
    workgroupSize: [8, 8, 1],
    width,
    height,
    channels,
  };
}

export function resolveMeshSettings(pass: { useViewerCamera?: boolean; geometry?: { type: string; path?: string; mesh?: string; resolved_path?: string } } | undefined, shaderDefault?: boolean): { modelPath?: string; modelMesh?: string; useViewerCamera?: boolean } {
  const useViewerCamera = pass?.useViewerCamera ?? shaderDefault;
  const camera = useViewerCamera === undefined ? {} : { useViewerCamera };
  if (pass?.geometry?.type !== "model") {
    return camera;
  }
  return { modelPath: pass.geometry.resolved_path ?? pass.geometry.path, modelMesh: pass.geometry.mesh,
    ...camera };
}

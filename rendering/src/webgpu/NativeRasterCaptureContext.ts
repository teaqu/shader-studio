import type { CaptureCompileContext } from "../capture/VariableCapturer";
import type { RenderPassNode } from "../types/PassGraph";
import type { WebGPUMeshResources } from "./WebGPUMeshResources";

/** Capture keeps the installed pass identity while resolving geometry buffers live. */
export function nativeRasterCaptureContext(
  pass: RenderPassNode | undefined,
  resources: () => WebGPUMeshResources | null,
  meshUniformData?: () => Float32Array,
  writesDepth = false,
): CaptureCompileContext["nativeRender"] {
  if (!pass?.entryPoints || (!pass.entryPoints.vertex && !pass.entryPoints.fragment)) {
    return undefined;
  }
  return {
    vertexEntryPoint: pass.entryPoints.vertex,
    ...(pass.vertexSrc ? { vertexCode: pass.vertexSrc } : {}),
    ...(pass.entryPoints.fragment ? { fragmentEntryPoint: pass.entryPoints.fragment } : {}),
    geometry: pass.geometry,
    ...(pass.useViewerCamera === undefined ? {} : { useViewerCamera: pass.useViewerCamera }),
    width: pass.width,
    height: pass.height,
    ...(pass.outputCount ? { outputCount: pass.outputCount } : {}),
    ...(writesDepth ? { writesDepth: true } : {}),
    ...(meshUniformData ? { meshUniformData } : {}),
    draw: encoder => {
      if (pass.geometry === "fullscreen") {
        encoder.draw(3);
        return;
      }
      const meshes = resources();
      const mesh = pass.modelPath
        ? meshes?.getModel(pass.name)
        : pass.geometry === "model" ? undefined : meshes?.get(pass.geometry);
      if (!mesh) {
        throw new Error(`Native raster geometry for '${pass.name}' is unavailable.`);
      }
      encoder.setVertexBuffer(0, mesh.vertexBuffer);
      encoder.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
      encoder.drawIndexed(mesh.indexCount);
    },
  };
}

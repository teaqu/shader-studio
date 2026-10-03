import type { CaptureCompileContext } from "../capture/VariableCapturer";
import type { RenderPassNode } from "../types/PassGraph";
import type { WebGPUMeshResources } from "./WebGPUMeshResources";

/** Capture keeps the installed pass identity while resolving geometry buffers live. */
export function nativeRasterCaptureContext(
  pass: RenderPassNode | undefined,
  resources: () => WebGPUMeshResources | null,
): CaptureCompileContext["nativeRender"] {
  if (!pass?.entryPoints) {
    return undefined;
  }
  return {
    vertexEntryPoint: pass.entryPoints.vertex,
    fragmentEntryPoint: pass.entryPoints.fragment,
    geometry: pass.geometry,
    width: pass.width,
    height: pass.height,
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

import { FULLSCREEN_VERTEX_COUNT } from "@shader-studio/types";
import type { CameraMatrices, OrbitCamera } from "../preview3d/OrbitCamera";
import { verticesVertexCount } from "../types/Geometry";
import type { RenderPassNode } from "./SlangPassGraph";
import type { WebGPUMeshResource, WebGPUMeshResources } from "./WebGPUMeshResources";

interface WebGPUGeometryDependencies {
  meshResources: Pick<WebGPUMeshResources, "get" | "getModel"> | null;
  meshCamera: Pick<OrbitCamera, "getMatrices">;
}

/** Shares pass geometry and camera resolution between rendering and capture. */
export class WebGPUGeometry {
  constructor(private readonly host: WebGPUGeometryDependencies) {}

  /** The loaded mesh a render pass draws; undefined for fullscreen, vertices, or a model still loading. */
  resolvePassMesh(pass: RenderPassNode): WebGPUMeshResource | undefined {
    if (!pass.geometry || pass.geometry === "fullscreen" || pass.geometry === "vertices") {
      return undefined;
    }
    return pass.modelPath
      ? this.host.meshResources?.getModel(pass.name)
      : pass.geometry === "model" ? undefined : this.host.meshResources?.get(pass.geometry);
  }

  /** iViewMatrix, iProjectionMatrix and iViewProjection: the orbit camera at the pass's aspect ratio. */
  passCameraMatrices(pass: { width: number; height: number }): CameraMatrices {
    return this.host.meshCamera.getMatrices(pass.width / Math.max(pass.height, 1), "webgpu");
  }

  /** iVertexCount: the vertices the pass draws, matching the range of vertexIndex. */
  resolvePassVertexCount(pass: RenderPassNode): number {
    if (pass.geometry === "vertices") {
      return verticesVertexCount(pass);
    }
    return !pass.geometry || pass.geometry === "fullscreen"
      ? FULLSCREEN_VERTEX_COUNT
      : this.resolvePassMesh(pass)?.vertexCount ?? 0;
  }

}

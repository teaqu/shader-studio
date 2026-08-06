/// <reference types="@webgpu/types" />
import type { GeometryType } from "@shader-studio/types";
import { createPreviewMesh } from "../preview3d/meshes";

type MeshKind = Exclude<GeometryType, "fullscreen">;

export interface WebGPUMeshResource { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer; indexCount: number; }

export class WebGPUMeshResources {
  private readonly resources = new Map<MeshKind, WebGPUMeshResource>();
  constructor(private readonly device: GPUDevice) {}
  get(kind: MeshKind): WebGPUMeshResource {
    let resource = this.resources.get(kind);
    if (!resource) {
      const mesh = createPreviewMesh(kind);
      const data = new Float32Array((mesh.positions.length / 3) * 8);
      for (let index = 0; index < mesh.positions.length / 3; index += 1) {
        data.set(mesh.positions.subarray(index * 3, index * 3 + 3), index * 8);
        data.set(mesh.normals.subarray(index * 3, index * 3 + 3), index * 8 + 3);
        data.set(mesh.uvs.subarray(index * 2, index * 2 + 2), index * 8 + 6);
      }
      const vertexBuffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      const indexBuffer = this.device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(vertexBuffer, 0, data);
      this.device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
      resource = { vertexBuffer, indexBuffer, indexCount: mesh.indices.length };
      this.resources.set(kind, resource);
    }
    return resource;
  }
  dispose(): void { for (const resource of this.resources.values()) { resource.vertexBuffer.destroy(); resource.indexBuffer.destroy(); } this.resources.clear(); }
}

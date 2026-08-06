/// <reference types="@webgpu/types" />
import type { GeometryType } from "@shader-studio/types";
import { createPreviewMesh } from "../preview3d/meshes";
import { loadGlbMesh } from "../preview3d/GltfMeshLoader";
import type { PreviewMesh } from "../preview3d/types";

type MeshKind = Exclude<GeometryType, "fullscreen" | "model">;

export interface WebGPUMeshResource { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer; indexCount: number; indexFormat: GPUIndexFormat; }

export class WebGPUMeshResources {
  private readonly resources = new Map<MeshKind, WebGPUMeshResource>();
  constructor(private readonly device: GPUDevice) {}
  get(kind: MeshKind): WebGPUMeshResource {
    let resource = this.resources.get(kind);
    if (!resource) {
      resource = this.upload(createPreviewMesh(kind));
      this.resources.set(kind, resource);
    }
    return resource;
  }
  async loadModel(key: string, url: string, meshName?: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load GLB (${response.status}): ${url}`);
    const previous = this.resources.get(key as MeshKind);
    const resource = this.upload(await loadGlbMesh(new Uint8Array(await response.arrayBuffer()), meshName));
    this.resources.set(key as MeshKind, resource);
    previous?.vertexBuffer.destroy(); previous?.indexBuffer.destroy();
  }
  getModel(key: string): WebGPUMeshResource | undefined { return this.resources.get(key as MeshKind); }
  dispose(): void { for (const resource of this.resources.values()) { resource.vertexBuffer.destroy(); resource.indexBuffer.destroy(); } this.resources.clear(); }
  private upload(mesh: PreviewMesh): WebGPUMeshResource {
    const data = new Float32Array((mesh.positions.length / 3) * 8);
    for (let index = 0; index < mesh.positions.length / 3; index += 1) {
      data.set(mesh.positions.subarray(index * 3, index * 3 + 3), index * 8);
      data.set(mesh.normals.subarray(index * 3, index * 3 + 3), index * 8 + 3);
      data.set(mesh.uvs.subarray(index * 2, index * 2 + 2), index * 8 + 6);
    }
    const vertexBuffer = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const indexBuffer = this.device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vertexBuffer, 0, data); this.device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
    return { vertexBuffer, indexBuffer, indexCount: mesh.indices.length, indexFormat: mesh.indices instanceof Uint32Array ? "uint32" : "uint16" };
  }
}

import { createPreviewMesh } from "../preview3d/meshes";
import type { GeometryType } from "@shader-studio/types";

type MeshKind = Exclude<GeometryType, "fullscreen">;

interface MeshResource {
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  indexCount: number;
}

export class WebGLMeshResources {
  private readonly resources = new Map<MeshKind, MeshResource>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  public get(kind: MeshKind): Pick<MeshResource, "vao" | "indexCount"> {
    let resource = this.resources.get(kind);
    if (!resource) {
      resource = this.upload(kind);
      this.resources.set(kind, resource);
    }
    return resource;
  }

  public dispose(): void {
    for (const resource of this.resources.values()) {
      this.gl.deleteVertexArray(resource.vao);
      this.gl.deleteBuffer(resource.vertexBuffer);
      this.gl.deleteBuffer(resource.indexBuffer);
    }
    this.resources.clear();
  }

  private upload(kind: MeshKind): MeshResource {
    const mesh = createPreviewMesh(kind);
    const vertexCount = mesh.positions.length / 3;
    const data = new Float32Array(vertexCount * 8);
    for (let index = 0; index < vertexCount; index += 1) {
      data.set(mesh.positions.subarray(index * 3, index * 3 + 3), index * 8);
      data.set(mesh.normals.subarray(index * 3, index * 3 + 3), index * 8 + 3);
      data.set(mesh.uvs.subarray(index * 2, index * 2 + 2), index * 8 + 6);
    }

    const vao = this.gl.createVertexArray();
    const vertexBuffer = this.gl.createBuffer();
    const indexBuffer = this.gl.createBuffer();
    if (!vao || !vertexBuffer || !indexBuffer) {
      if (vao) {
        this.gl.deleteVertexArray(vao);
      }
      if (vertexBuffer) {
        this.gl.deleteBuffer(vertexBuffer);
      }
      if (indexBuffer) {
        this.gl.deleteBuffer(indexBuffer);
      }
      throw new Error("Unable to allocate WebGL mesh geometry");
    }

    this.gl.bindVertexArray(vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, mesh.indices, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 3, this.gl.FLOAT, false, 32, 0);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 3, this.gl.FLOAT, false, 32, 12);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 2, this.gl.FLOAT, false, 32, 24);
    this.gl.bindVertexArray(null);
    return { vao, vertexBuffer, indexBuffer, indexCount: mesh.indices.length };
  }
}

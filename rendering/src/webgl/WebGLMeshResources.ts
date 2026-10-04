import { createEdgeIndices, createPreviewMesh } from "../preview3d/meshes";
import { loadGlbMesh } from "../preview3d/GltfMeshLoader";
import type { PreviewMesh } from "../preview3d/types";
import type { GeometryType } from "@shader-studio/types";

type MeshKind = Exclude<GeometryType, "fullscreen" | "vertices" | "model">;

interface MeshResource {
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  indexCount: number;
  indexType: GLenum;
  /** Distinct mesh vertices, the range of gl_VertexID (iVertexCount). */
  vertexCount: number;
  /** The same vertices with the unique-edge index buffer bound, for line-list topology. */
  edgeVao: WebGLVertexArrayObject;
  edgeIndexBuffer: WebGLBuffer;
  edgeIndexCount: number;
}

/** What a draw needs from a mesh: both index views and the vertex count. */
export type WebGLMeshDraw = Pick<MeshResource, "vao" | "indexCount" | "indexType" | "vertexCount" | "edgeVao" | "edgeIndexCount">;

export class WebGLMeshResources {
  private readonly resources = new Map<MeshKind, MeshResource>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  public get(kind: MeshKind): WebGLMeshDraw {
    let resource = this.resources.get(kind);
    if (!resource) {
      resource = this.upload(kind);
      this.resources.set(kind, resource);
    }
    return resource;
  }

  public getModel(key: string): WebGLMeshDraw | undefined {
    return this.resources.get(key as MeshKind);
  }

  public async loadModel(key: string, url: string, meshName?: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load GLB (${response.status}): ${url}`);
    }
    const previous = this.resources.get(key as MeshKind);
    const resource = this.uploadMesh(await loadGlbMesh(new Uint8Array(await response.arrayBuffer()), meshName));
    this.resources.set(key as MeshKind, resource);
    if (previous) {
      this.release(previous);
    }
  }

  public dispose(): void {
    for (const resource of this.resources.values()) {
      this.release(resource);
    }
    this.resources.clear();
  }

  private release(resource: MeshResource): void {
    this.gl.deleteVertexArray(resource.vao);
    this.gl.deleteVertexArray(resource.edgeVao);
    this.gl.deleteBuffer(resource.vertexBuffer);
    this.gl.deleteBuffer(resource.indexBuffer);
    this.gl.deleteBuffer(resource.edgeIndexBuffer);
  }

  private upload(kind: MeshKind): MeshResource {
    return this.uploadMesh(createPreviewMesh(kind));
  }

  private uploadMesh(mesh: PreviewMesh): MeshResource {
    const vertexCount = mesh.positions.length / 3;
    const data = new Float32Array(vertexCount * 8);
    for (let index = 0; index < vertexCount; index += 1) {
      data.set(mesh.positions.subarray(index * 3, index * 3 + 3), index * 8);
      data.set(mesh.normals.subarray(index * 3, index * 3 + 3), index * 8 + 3);
      data.set(mesh.uvs.subarray(index * 2, index * 2 + 2), index * 8 + 6);
    }

    const edgeIndices = createEdgeIndices(mesh.indices);
    const vao = this.gl.createVertexArray();
    const edgeVao = this.gl.createVertexArray();
    const vertexBuffer = this.gl.createBuffer();
    const indexBuffer = this.gl.createBuffer();
    const edgeIndexBuffer = this.gl.createBuffer();
    if (!vao || !edgeVao || !vertexBuffer || !indexBuffer || !edgeIndexBuffer) {
      for (const array of [vao, edgeVao]) {
        if (array) {
          this.gl.deleteVertexArray(array);
        }
      }
      for (const buffer of [vertexBuffer, indexBuffer, edgeIndexBuffer]) {
        if (buffer) {
          this.gl.deleteBuffer(buffer);
        }
      }
      throw new Error("Unable to allocate WebGL mesh geometry");
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
    this.bindVertexArray(vao, vertexBuffer, indexBuffer, mesh.indices);
    this.bindVertexArray(edgeVao, vertexBuffer, edgeIndexBuffer, edgeIndices);
    return {
      vao, vertexBuffer, indexBuffer, vertexCount, indexCount: mesh.indices.length,
      indexType: mesh.indices instanceof Uint32Array ? this.gl.UNSIGNED_INT : this.gl.UNSIGNED_SHORT,
      edgeVao, edgeIndexBuffer, edgeIndexCount: edgeIndices.length,
    };
  }

  /** Records the interleaved position/normal/uv attributes and an index buffer in a vertex array. */
  private bindVertexArray(vao: WebGLVertexArrayObject, vertexBuffer: WebGLBuffer, indexBuffer: WebGLBuffer, indices: Uint16Array | Uint32Array): void {
    this.gl.bindVertexArray(vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 3, this.gl.FLOAT, false, 32, 0);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 3, this.gl.FLOAT, false, 32, 12);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 2, this.gl.FLOAT, false, 32, 24);
    this.gl.bindVertexArray(null);
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Document, WebIO } from '@gltf-transform/core';
import { WebGLMeshResources } from "../../webgl/WebGLMeshResources";

const createGl = () => ({
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88e4,
  FLOAT: 0x1406,
  UNSIGNED_INT: 0x1405,
  UNSIGNED_SHORT: 0x1403,
  createVertexArray: vi.fn(() => ({})),
  createBuffer: vi.fn(() => ({})),
  bindVertexArray: vi.fn(),
  bindBuffer: vi.fn(),
  bufferData: vi.fn(),
  enableVertexAttribArray: vi.fn(),
  vertexAttribPointer: vi.fn(),
  deleteVertexArray: vi.fn(),
  deleteBuffer: vi.fn(),
});

describe("WebGLMeshResources", () => {
  let gl: ReturnType<typeof createGl>;

  beforeEach(() => {
    gl = createGl();
  });

  it("uploads interleaved position, normal, and UV attributes at the generated shader locations", () => {
    const resources = new WebGLMeshResources(gl as unknown as WebGL2RenderingContext);
    const mesh = resources.get("plane");

    expect(mesh.indexCount).toBe(6);
    // Distinct vertices back iVertexCount, the range of gl_VertexID.
    expect(mesh.vertexCount).toBe(4);
    expect(gl.vertexAttribPointer).toHaveBeenNthCalledWith(1, 0, 3, gl.FLOAT, false, 32, 0);
    expect(gl.vertexAttribPointer).toHaveBeenNthCalledWith(2, 1, 3, gl.FLOAT, false, 32, 12);
    expect(gl.vertexAttribPointer).toHaveBeenNthCalledWith(3, 2, 2, gl.FLOAT, false, 32, 24);
    expect(resources.get("plane")).toBe(mesh);
  });

  it("records the unique edges in a second vertex array over the same vertex buffer", () => {
    const resources = new WebGLMeshResources(gl as unknown as WebGL2RenderingContext);
    const mesh = resources.get("plane");

    expect(mesh.edgeIndexCount).toBe(10);
    expect(mesh.edgeVao).not.toBe(mesh.vao);
    const elementUploads = gl.bufferData.mock.calls.filter(([target]) => target === gl.ELEMENT_ARRAY_BUFFER).map(([, data]) => Array.from(data as Uint16Array));
    expect(elementUploads).toEqual([[0, 2, 1, 0, 3, 2], [0, 2, 2, 1, 1, 0, 0, 3, 3, 2]]);
    // Each vertex array records all three attributes.
    expect(gl.vertexAttribPointer).toHaveBeenCalledTimes(6);
  });

  it("deletes everything it allocated when an allocation fails", () => {
    gl.createBuffer.mockReturnValueOnce({}).mockReturnValueOnce({}).mockReturnValueOnce(null as never);
    const resources = new WebGLMeshResources(gl as unknown as WebGL2RenderingContext);

    expect(() => resources.get("plane")).toThrow("Unable to allocate WebGL mesh geometry");
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  });

  it("deletes each cached mesh resource once", () => {
    const resources = new WebGLMeshResources(gl as unknown as WebGL2RenderingContext);
    resources.get("cube");
    resources.get("sphere");

    resources.dispose();
    resources.dispose();

    // Per mesh: the triangle and edge vertex arrays, and the vertex, index and edge index buffers.
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(4);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(6);
  });

  it('loads a named GLB mesh and preserves its 32-bit index format', async () => {
    const document = new Document();
    const buffer = document.createBuffer();
    document.createMesh('CatBody').addPrimitive(document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer))
      .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array([0, 1, 2])).setBuffer(buffer)));
    const bytes = await new WebIO().writeBinary(document);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer) }));
    const resources = new WebGLMeshResources(gl as unknown as WebGL2RenderingContext);

    await resources.loadModel('Image', 'cat.glb', 'CatBody');

    expect(resources.getModel('Image')).toMatchObject({ indexCount: 3, indexType: gl.UNSIGNED_INT, vertexCount: 3 });
  });
});

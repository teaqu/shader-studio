import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebGLMeshResources } from "../../webgl/WebGLMeshResources";

const createGl = () => ({
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  STATIC_DRAW: 0x88e4,
  FLOAT: 0x1406,
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
    expect(gl.vertexAttribPointer).toHaveBeenNthCalledWith(1, 0, 3, gl.FLOAT, false, 32, 0);
    expect(gl.vertexAttribPointer).toHaveBeenNthCalledWith(2, 1, 3, gl.FLOAT, false, 32, 12);
    expect(gl.vertexAttribPointer).toHaveBeenNthCalledWith(3, 2, 2, gl.FLOAT, false, 32, 24);
    expect(resources.get("plane")).toBe(mesh);
  });

  it("deletes each cached mesh resource once", () => {
    const resources = new WebGLMeshResources(gl as unknown as WebGL2RenderingContext);
    resources.get("cube");
    resources.get("sphere");

    resources.dispose();
    resources.dispose();

    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(4);
  });
});

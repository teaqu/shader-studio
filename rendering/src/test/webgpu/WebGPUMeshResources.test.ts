import { describe, expect, it, vi } from "vitest";
import { WebGPUMeshResources } from "../../webgpu/WebGPUMeshResources";
import { createEdgeIndices, createPreviewMesh } from "../../preview3d/meshes";

const createDevice = () => ({
  createBuffer: vi.fn(({ size }: { size: number }) => ({ size, destroy: vi.fn() })),
  queue: { writeBuffer: vi.fn() },
});

describe("WebGPUMeshResources", () => {
  it.each(["plane", "cube", "sphere"] as const)("reports the %s mesh's distinct vertex count for iVertexCount", (kind) => {
    const device = createDevice();
    const resources = new WebGPUMeshResources(device as unknown as GPUDevice);
    const expected = createPreviewMesh(kind);

    const mesh = resources.get(kind);

    expect(mesh.vertexCount).toBe(expected.positions.length / 3);
    expect(mesh.indexCount).toBe(expected.indices.length);
    expect(mesh.vertexBuffer).toMatchObject({ size: mesh.vertexCount * 32 });
    expect(resources.get(kind)).toBe(mesh);
  });

  it.each(["plane", "cube", "sphere"] as const)("uploads the %s mesh's unique edges in the triangle index format", (kind) => {
    const device = createDevice();
    const mesh = new WebGPUMeshResources(device as unknown as GPUDevice).get(kind);
    const edges = createEdgeIndices(createPreviewMesh(kind).indices);

    expect(mesh.edgeIndexCount).toBe(edges.length);
    expect(mesh.edgeIndexBuffer).toMatchObject({ size: edges.byteLength });
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(mesh.edgeIndexBuffer, 0, edges);
  });

  it("destroys the edge buffers with the rest of a mesh", () => {
    const resources = new WebGPUMeshResources(createDevice() as unknown as GPUDevice);
    const mesh = resources.get("cube");

    resources.dispose();

    expect(mesh.edgeIndexBuffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("gives the plane four vertices, matching the indices its hook receives", () => {
    const resources = new WebGPUMeshResources(createDevice() as unknown as GPUDevice);

    expect(resources.get("plane").vertexCount).toBe(4);
  });
});

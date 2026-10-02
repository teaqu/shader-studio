import { describe, expect, it, vi } from "vitest";
import { WebGPUMeshResources } from "../../webgpu/WebGPUMeshResources";
import { createPreviewMesh } from "../../preview3d/meshes";

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

  it("gives the plane four vertices, matching the indices its hook receives", () => {
    const resources = new WebGPUMeshResources(createDevice() as unknown as GPUDevice);

    expect(resources.get("plane").vertexCount).toBe(4);
  });
});

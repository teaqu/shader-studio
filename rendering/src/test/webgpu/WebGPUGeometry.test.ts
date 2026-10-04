import { describe, expect, it, vi } from "vitest";
import { FULLSCREEN_VERTEX_COUNT } from "@shader-studio/types";
import { OrbitCamera } from "../../preview3d/OrbitCamera";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import { WebGPUGeometry } from "../../webgpu/WebGPUGeometry";
import type { WebGPUMeshResources, WebGPUMeshResource } from "../../webgpu/WebGPUMeshResources";

function pass(geometry: "fullscreen" | "vertices" | "cube" | "model") {
  return buildSlangPassGraph({
    imageCode: "void mainImage(out float4 color, float2 coord) {}",
    config: { version: "1", passes: { Image: {
      inputs: {}, geometry: geometry === "model" ? { type: "model", path: "mesh.glb" }
        : geometry === "vertices" ? { type: "vertices", vertexCount: 7 } : { type: geometry },
    } } },
    buffers: {}, canvasWidth: 320, canvasHeight: 180,
  }).passes[0];
}

// Only geometry capabilities are needed: these tests do not construct an engine or GPU.
function harness() {
  let resources: Pick<WebGPUMeshResources, "get" | "getModel"> | null = null;
  const camera = new OrbitCamera();
  return {
    geometry: new WebGPUGeometry({ get meshResources() {
      return resources; 
    }, meshCamera: camera }),
    camera,
    setResources(value: typeof resources) {
      resources = value; 
    },
  };
}

function mesh(vertexCount: number): WebGPUMeshResource {
  const buffer = { destroy: vi.fn() } as unknown as GPUBuffer;
  return { vertexBuffer: buffer, indexBuffer: buffer, edgeIndexBuffer: buffer,
    indexCount: 6, indexFormat: "uint16", vertexCount, edgeIndexCount: 8 };
}

describe("WebGPUGeometry", () => {
  it("resolves fullscreen and procedural vertex counts without mesh resources", () => {
    const { geometry } = harness();
    expect(geometry.resolvePassVertexCount(pass("fullscreen"))).toBe(FULLSCREEN_VERTEX_COUNT);
    expect(geometry.resolvePassVertexCount(pass("vertices"))).toBe(7);
    expect(geometry.resolvePassMesh(pass("vertices"))).toBeUndefined();
  });

  it("uses live mesh resources after initialization or replacement", () => {
    const { geometry, setResources } = harness();
    const cube = pass("cube");
    expect(geometry.resolvePassVertexCount(cube)).toBe(0);
    const first = mesh(24);
    setResources({ get: () => first, getModel: () => undefined });
    expect(geometry.resolvePassMesh(cube)).toBe(first);
    expect(geometry.resolvePassVertexCount(cube)).toBe(24);
    const replacement = mesh(32);
    setResources({ get: () => replacement, getModel: () => undefined });
    expect(geometry.resolvePassVertexCount(cube)).toBe(32);
    setResources(null);
    expect(geometry.resolvePassVertexCount(cube)).toBe(0);
  });

  it("handles models still loading and resolves loaded models by pass name", () => {
    const { geometry, setResources } = harness();
    const model = pass("model");
    const getModel = vi.fn((): WebGPUMeshResource | undefined => undefined);
    const get = vi.fn(() => mesh(24));
    setResources({ get, getModel });
    expect(geometry.resolvePassVertexCount(model)).toBe(0);
    getModel.mockReturnValue(mesh(12));
    expect(geometry.resolvePassVertexCount(model)).toBe(12);
    expect(getModel).toHaveBeenCalledWith("Image");
    expect(get).not.toHaveBeenCalled();
  });

  it("shares camera matrices at the pass aspect ratio, including zero-height fallback", () => {
    const { geometry, camera } = harness();
    expect(geometry.passCameraMatrices({ width: 320, height: 180 })).toEqual(camera.getMatrices(320 / 180, "webgpu"));
    expect(geometry.passCameraMatrices({ width: 320, height: 0 })).toEqual(camera.getMatrices(320, "webgpu"));
  });
});

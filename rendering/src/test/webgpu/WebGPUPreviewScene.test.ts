import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREVIEW_SETTINGS } from "../../preview3d/types";
import { WebGPUPreviewScene } from "../../webgpu/WebGPUPreviewScene";

function device() {
  const queue = { writeBuffer: vi.fn(), submit: vi.fn() };
  return {
    queue,
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
  } as unknown as GPUDevice;
}

describe("WebGPUPreviewScene", () => {
  it("uploads interleaved indexed geometry, writes preview matrices, and recreates depth resources", () => {
    const gpu = device();
    const scene = new WebGPUPreviewScene(gpu, "bgra8unorm");
    scene.setSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d", mesh: "cube" });
    scene.getDepthView(120, 80);
    scene.getDepthView(120, 80);
    scene.getDepthView(121, 80);
    const previewBuffer = {} as GPUBuffer;
    scene.writePreviewUniforms({ getPreviewUniformBuffer: () => previewBuffer } as any, 120, 80);

    expect(gpu.createBuffer).toHaveBeenCalled();
    expect(gpu.queue.writeBuffer).toHaveBeenCalledWith(previewBuffer, 0, expect.any(Float32Array));
    expect(gpu.createTexture).toHaveBeenCalledTimes(2);
  });

  it("keeps the last mesh and depth resources when a replacement allocation fails, then retries", () => {
    const gpu = device();
    const scene = new WebGPUPreviewScene(gpu, "bgra8unorm");
    scene.setSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d", mesh: "cube" });
    const oldMesh = (scene as any).mesh;
    (scene as any).getDepthView(40, 40);
    const oldDepthTexture = (scene as any).depthTexture;
    (gpu.createBuffer as any).mockImplementationOnce(() => {
      throw new Error("out of memory");
    });

    expect(() => scene.setSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d", mesh: "sphere" })).toThrow(/out of memory/);
    expect((scene as any).mesh).toBe(oldMesh);
    expect((scene as any).meshKind).toBe("cube");
    (gpu.createTexture as any).mockImplementationOnce(() => {
      throw new Error("depth allocation failed");
    });
    expect(() => scene.getDepthView(41, 40)).toThrow(/depth allocation failed/);
    expect((scene as any).depthTexture).toBe(oldDepthTexture);
    expect(() => scene.setSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d", mesh: "sphere" })).not.toThrow();
    expect((scene as any).meshKind).toBe("sphere");
  });

  it("encodes grid, mesh, then axes and disposes all owned buffers", () => {
    const gpu = device();
    const scene = new WebGPUPreviewScene(gpu, "bgra8unorm");
    scene.setSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d", mesh: "plane" });
    const calls: string[] = [];
    const pass = {
      setPipeline: () => calls.push("line-pipeline"), setBindGroup: () => calls.push("line-bind"),
      setVertexBuffer: () => calls.push("vertex"), setIndexBuffer: () => calls.push("index"), drawIndexed: () => calls.push("draw"),
    } as unknown as GPURenderPassEncoder;
    scene.encodeGrid(pass, 100, 100);
    scene.encodeMesh(pass);
    scene.encodeAxes(pass, 100, 100);
    scene.dispose();

    expect(calls.filter((call) => call === "draw")).toHaveLength(3);
    expect(gpu.createBuffer.mock.results.every((result: any) => result.value.destroy.mock.calls.length === 1)).toBe(true);
  });

  it("destroys both buffers when the second upload write fails", () => {
    const gpu = device();
    (gpu.queue.writeBuffer as any).mockImplementationOnce(() => {}).mockImplementationOnce(() => {
      throw new Error("queue lost");
    });
    expect(() => new WebGPUPreviewScene(gpu, "bgra8unorm")).toThrow(/queue lost/);
    const created = (gpu.createBuffer as any).mock.results.map((result: any) => result.value);
    expect(created[0].destroy).toHaveBeenCalledOnce();
    expect(created[1].destroy).toHaveBeenCalledOnce();
  });
});

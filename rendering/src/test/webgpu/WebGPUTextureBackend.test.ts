import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebGPUTextureBackend, expandR8ToRgba8 } from "../../webgpu/WebGPUTextureBackend";

// jsdom has no WebGPU globals; GPUTextureUsage/GPUShaderStage are already
// stubbed globally in src/test/setup.ts, so no local vi.stubGlobal needed here.

function mockDevice() {
  const makeTexture = (desc: GPUTextureDescriptor) => ({
    desc,
    createView: vi.fn((viewDesc?: GPUTextureViewDescriptor) => ({ viewDesc })),
    destroy: vi.fn(),
  });
  const device = {
    createTexture: vi.fn(makeTexture),
    createSampler: vi.fn((desc: GPUSamplerDescriptor) => ({ desc })),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() })),
      finish: vi.fn(() => ({})),
    })),
    queue: { writeTexture: vi.fn(), copyExternalImageToTexture: vi.fn(), submit: vi.fn() },
  };
  return device as unknown as GPUDevice & typeof device;
}

describe("expandR8ToRgba8", () => {
  it("replicates r into rgb with opaque alpha", () => {
    expect(Array.from(expandR8ToRgba8(new Uint8Array([7, 200]), 2, 1)))
      .toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
  });
});

describe("WebGPUTextureBackend.createTexture", () => {
  let device: ReturnType<typeof mockDevice>;
  let backend: WebGPUTextureBackend;

  beforeEach(() => {
    device = mockDevice();
    backend = new WebGPUTextureBackend(device);
  });

  it("creates an rgba8unorm texture with view, sampler, and dimensions", () => {
    const handle = backend.createTexture({ type: "2d", width: 4, height: 2, format: "rgba8", filter: "linear", wrap: "repeat" });
    expect(handle).not.toBeNull();
    expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({
      size: { width: 4, height: 2 },
      format: "rgba8unorm",
      mipLevelCount: 1,
    }));
    expect(handle!.width).toBe(4);
    expect(handle!.height).toBe(2);
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({
      magFilter: "linear", minFilter: "linear",
      addressModeU: "repeat", addressModeV: "repeat",
    }));
  });

  it("nearest filter and clamp wrap map to nearest sampler with clamp-to-edge", () => {
    backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "nearest", wrap: "clamp" });
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({
      magFilter: "nearest", minFilter: "nearest",
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    }));
  });

  it("mipmap filter allocates the full mip chain with render-attachment usage and a mipmapFilter sampler", () => {
    backend.createTexture({ type: "2d", width: 8, height: 4, format: "rgba8", filter: "mipmap", wrap: "repeat" });
    const desc = device.createTexture.mock.calls[0][0] as GPUTextureDescriptor;
    expect(desc.mipLevelCount).toBe(4); // floor(log2(8)) + 1
    expect((desc.usage as number) & GPUTextureUsage.RENDER_ATTACHMENT).toBeTruthy();
    expect(device.createSampler).toHaveBeenCalledWith(expect.objectContaining({ mipmapFilter: "linear" }));
  });

  it("uploads rgba8 data verbatim via writeTexture", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp", data });
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture: handle!.texture },
      data,
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
  });

  it("expands r8 data to replicated rgba8 on upload", () => {
    backend.createTexture({ type: "2d", width: 2, height: 1, format: "r8", filter: "nearest", wrap: "clamp", data: new Uint8Array([9, 10]) });
    const uploaded = device.queue.writeTexture.mock.calls[0][1] as Uint8Array;
    expect(Array.from(uploaded)).toEqual([9, 9, 9, 255, 10, 10, 10, 255]);
    expect(device.queue.writeTexture.mock.calls[0][2]).toEqual({ bytesPerRow: 8 });
  });

  it("throws for cubemap type", () => {
    expect(() => backend.createTexture({ type: "cubemap", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" }))
      .toThrow(/[Cc]ubemap.*not supported/);
  });

  it("updateTexture writes the subregion with r8 expansion", () => {
    const handle = backend.createTexture({ type: "2d", width: 4, height: 4, format: "r8", filter: "nearest", wrap: "clamp" })!;
    device.queue.writeTexture.mockClear();
    backend.updateTexture(handle, 0, 1, 4, 1, new Uint8Array([1, 2, 3, 4]));
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture: handle.texture, origin: { x: 0, y: 1 } },
      expandR8ToRgba8(new Uint8Array([1, 2, 3, 4]), 4, 1),
      { bytesPerRow: 16 },
      { width: 4, height: 1 },
    );
  });

  it("updateTexture writes rgba8 verbatim when the handle was created with rgba8 format", () => {
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    device.queue.writeTexture.mockClear();
    const data = new Uint8Array([5, 6, 7, 8]);
    backend.updateTexture(handle, 0, 0, 1, 1, data);
    expect(device.queue.writeTexture).toHaveBeenCalledWith(
      { texture: handle.texture },
      data,
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
  });

  it("destroyTexture destroys the GPU texture and tolerates null", () => {
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    backend.destroyTexture(handle);
    expect((handle.texture as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalled();
    expect(() => backend.destroyTexture(null)).not.toThrow();
  });

  it("sets vflip to false on newly created handles", () => {
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    expect(handle.vflip).toBe(false);
  });

  it("createMipmaps is a graceful no-op stub (Task 9 fills it in)", () => {
    const handle = backend.createTexture({ type: "2d", width: 8, height: 4, format: "rgba8", filter: "mipmap", wrap: "repeat", data: new Uint8Array(8 * 4 * 4) })!;
    expect(() => backend.createMipmaps(handle)).not.toThrow();
  });

  it("createTextureFromImage and updateTextureFromImage throw Not implemented yet (Task 9)", () => {
    expect(() => backend.createTextureFromImage([], { type: "2d", format: "rgba8", filter: "linear", wrap: "clamp", vflip: false }))
      .toThrow(/Not implemented yet \(Task 9\)/);
    const handle = backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" })!;
    expect(() => backend.updateTextureFromImage(handle, {} as HTMLImageElement))
      .toThrow(/Not implemented yet \(Task 9\)/);
  });
});

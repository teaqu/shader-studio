import { describe, expect, it, vi } from "vitest";
import { NativeRasterCaptureTarget } from "../../webgpu/NativeRasterCaptureTarget";

function targetDevice() {
  const textures: Array<{ createView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createTexture: vi.fn(() => {
      const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
  } as unknown as GPUDevice;
  return { device, textures };
}

describe("NativeRasterCaptureTarget", () => {
  it("allocates at original raster resolution and includes depth only for mesh geometry", () => {
    const mesh = targetDevice();
    const target = new NativeRasterCaptureTarget(mesh.device, 100, 50, true);
    expect(mesh.device.createTexture).toHaveBeenCalledTimes(2);
    expect((mesh.device.createTexture as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      size: { width: 100, height: 50 }, format: "rgba32float",
    });
    expect(target.attachments()).toMatchObject({ depthStencilAttachment: { depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } });
    target.destroy();
    expect(mesh.textures[0]!.destroy).toHaveBeenCalledOnce();
    expect(mesh.textures[1]!.destroy).toHaveBeenCalledOnce();

    const fullscreen = targetDevice();
    const flatTarget = new NativeRasterCaptureTarget(fullscreen.device, 100, 50, false);
    expect(fullscreen.device.createTexture).toHaveBeenCalledOnce();
    expect(flatTarget.attachments()).not.toHaveProperty("depthStencilAttachment");
  });

  it("rejects non-positive raster dimensions before asking WebGPU to allocate them", () => {
    const { device } = targetDevice();
    expect(() => new NativeRasterCaptureTarget(device, 0, 50, false)).toThrow(/positive/);
    expect(() => new NativeRasterCaptureTarget(device, 50, -1, false)).toThrow(/positive/);
  });

  it("keeps scratch attachments ordered for native MRT and selects the requested readback output", () => {
    const { device, textures } = targetDevice();
    const target = new NativeRasterCaptureTarget(device, 100, 50, false, 3, 2);
    expect(target.textures).toHaveLength(1);
    expect(target.attachments().colorAttachments).toHaveLength(3);
    expect(target.texture).toBe(target.textures[0]);
    expect(target.attachments().colorAttachments).toEqual([null, null, expect.anything()]);
    target.destroy();
    expect(textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
  });

  it("rejects a readback output outside the native MRT attachments", () => {
    const { device } = targetDevice();
    expect(() => new NativeRasterCaptureTarget(device, 1, 1, false, 2, 2)).toThrow(/attachment/);
  });

  it("allocates depth for a fullscreen fragment that writes frag depth", () => {
    const { device, textures } = targetDevice();
    const target = new NativeRasterCaptureTarget(device, 8, 8, false, 1, 0, true);
    expect(textures).toHaveLength(2);
    expect(target.attachments()).toHaveProperty("depthStencilAttachment");
  });

  it("destroys its color attachment when creating the color view throws", () => {
    const { device, textures } = targetDevice();
    textures.push({
      createView: vi.fn(() => {
        throw new Error("view failed");
      }),
      destroy: vi.fn(),
    });
    (device.createTexture as ReturnType<typeof vi.fn>).mockImplementation(() => textures[0]);

    expect(() => new NativeRasterCaptureTarget(device, 8, 8, false)).toThrow("view failed");
    expect(textures[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("destroys its color attachment when depth allocation throws", () => {
    const { device, textures } = targetDevice();
    const color = { createView: vi.fn(() => ({})), destroy: vi.fn() };
    textures.push(color);
    (device.createTexture as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => color)
      .mockImplementationOnce(() => {
        throw new Error("depth allocation failed");
      });

    expect(() => new NativeRasterCaptureTarget(device, 8, 8, true)).toThrow("depth allocation failed");
    expect(color.destroy).toHaveBeenCalledOnce();
  });

  it("copies a clamped pixel and centered grid samples into packed row offsets", () => {
    const { device } = targetDevice();
    const target = new NativeRasterCaptureTarget(device, 100, 50, false);
    const pixelCopies = vi.fn();
    target.copy({ copyTextureToBuffer: pixelCopies } as unknown as GPUCommandEncoder, {} as GPUBuffer, 1, 1, 256, -4, 99, true);
    expect(pixelCopies).toHaveBeenCalledWith(expect.objectContaining({ origin: { x: 0, y: 49 } }), expect.objectContaining({ offset: 0, bytesPerRow: 256, rowsPerImage: 1 }), { width: 1, height: 1 });

    const gridCopies = vi.fn();
    target.copy({ copyTextureToBuffer: gridCopies } as unknown as GPUCommandEncoder, {} as GPUBuffer, 3, 2, 256, 0, 0, false);
    expect(gridCopies).toHaveBeenCalledTimes(6);
    expect(gridCopies.mock.calls.map(([source, destination]) => [source.origin, destination.offset])).toEqual([
      [{ x: 16, y: 12 }, 0], [{ x: 50, y: 12 }, 16], [{ x: 83, y: 12 }, 32],
      [{ x: 16, y: 37 }, 256], [{ x: 50, y: 37 }, 272], [{ x: 83, y: 37 }, 288],
    ]);
  });
});

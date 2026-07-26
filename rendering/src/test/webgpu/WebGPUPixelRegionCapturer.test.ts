import { describe, expect, it, vi } from "vitest";
import type { PixelRegionRequest } from "../../types/PixelRegion";
import { WebGPUPixelRegionCapturer } from "../../webgpu/WebGPUPixelRegionCapturer";
import { expectCanonicalRegion } from "../capture/canonicalPixelRegion";

const request = (requestId: number, centerX = 40, centerY = 50): PixelRegionRequest => ({
  requestId,
  centerX,
  centerY,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

interface MockBuffer {
  data: Uint8Array;
  map: Deferred<void>;
  mapAsync: ReturnType<typeof vi.fn>;
  getMappedRange: ReturnType<typeof vi.fn>;
  unmap: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const mockGpu = () => {
  const buffers: MockBuffer[] = [];
  const copyTextureToBuffer = vi.fn();
  const device = {
    createBuffer: vi.fn((desc: { size: number }) => {
      const map = deferred<void>();
      const data = new Uint8Array(desc.size);
      const buffer: MockBuffer = {
        data,
        map,
        mapAsync: vi.fn(() => map.promise),
        getMappedRange: vi.fn(() => data.buffer),
        unmap: vi.fn(),
        destroy: vi.fn(),
      };
      buffers.push(buffer);
      return buffer;
    }),
  } as unknown as GPUDevice;
  const encoder = { copyTextureToBuffer } as unknown as GPUCommandEncoder;
  return { device, encoder, buffers, copyTextureToBuffer };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("WebGPUPixelRegionCapturer", () => {
  it("copies a top-left 60px region into an aligned buffer and publishes owned RGBA bytes", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1));

    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100)).toBe(true);
    expect(gpu.device.createBuffer).toHaveBeenCalledWith({
      size: 256 * 60,
      usage: 0x0001 | 0x0008,
    });
    expect(gpu.copyTextureToBuffer).toHaveBeenCalledWith(
      { texture: expect.anything(), origin: { x: 10, y: 20, z: 0 } },
      { buffer: gpu.buffers[0], offset: 0, bytesPerRow: 256, rowsPerImage: 60 },
      { width: 60, height: 60, depthOrArrayLayers: 1 },
    );

    gpu.buffers[0].data.fill(0);
    gpu.buffers[0].data.set([3, 240, 2, 255], 30 * 256 + 30 * 4);
    capturer.beginMappings();
    expect(gpu.buffers[0].mapAsync).toHaveBeenCalledWith(0x0001);
    gpu.buffers[0].map.resolve();
    await flush();
    gpu.buffers[0].data.fill(9);

    const [result] = capturer.collectResults();
    expect(result).toMatchObject({ requestId: 1, width: 60, height: 60 });
    expect([...result.rgba.slice((30 * 60 + 30) * 4, (30 * 60 + 30) * 4 + 4)]).toEqual([3, 240, 2, 255]);
    expect(gpu.buffers[0].unmap).toHaveBeenCalledOnce();
  });

  it("reuses its buffer after a successful map and unmap", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    capturer.beginMappings();
    gpu.buffers[0].map.resolve();
    await flush();
    capturer.collectResults();

    capturer.queue(request(2, 50, 50));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    expect(gpu.device.createBuffer).toHaveBeenCalledOnce();
    expect(gpu.copyTextureToBuffer.mock.calls.at(-1)![1].buffer).toBe(gpu.buffers[0]);
  });

  it.each([
    ["left", request(1, 2, 50), { x: 0, y: 20, z: 0 }, [30, 30], [0, 0]],
    ["right", request(2, 98, 50), { x: 68, y: 20, z: 0 }, [30, 30], [59, 0]],
    ["top", request(3, 50, 2), { x: 20, y: 0, z: 0 }, [30, 30], [0, 0]],
    ["bottom", request(4, 50, 98), { x: 20, y: 68, z: 0 }, [30, 30], [0, 59]],
  ])("pads the %s edge while retaining the selected pixel", async (_edge, regionRequest, origin, selected, padded) => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(regionRequest);
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    expect(gpu.copyTextureToBuffer.mock.calls[0][0].origin).toEqual(origin);
    gpu.buffers[0].data.fill(9);
    capturer.beginMappings();
    gpu.buffers[0].map.resolve();
    await flush();
    const [result] = capturer.collectResults();
    const pixel = ([x, y]: number[]) => result.rgba[(y * 60 + x) * 4];
    expect(pixel(selected)).toBe(9);
    expect(pixel(padded)).toBe(0);
  });

  it("publishes transparent results for empty captures without allocating or mapping", () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1, -100, -100));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    capturer.queue(request(2));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 0, 0);
    expect(gpu.copyTextureToBuffer).not.toHaveBeenCalled();
    expect(gpu.device.createBuffer).not.toHaveBeenCalled();
    expect(capturer.collectResults()).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: 1 }), expect.objectContaining({ requestId: 2 }),
    ]));
  });

  it("keeps the newest queued request when all slots are occupied", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    for (let id = 1; id <= 3; id += 1) {
      capturer.queue(request(id, id * 10, 50));
      capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100);
      capturer.beginMappings();
    }
    capturer.queue(request(4, 90, 50));
    capturer.queue(request(5, 120, 50));
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100)).toBe(false);
    gpu.buffers[1].map.resolve();
    await flush();
    capturer.collectResults();
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100)).toBe(true);
    expect(gpu.copyTextureToBuffer.mock.calls.at(-1)![0].origin).toEqual({ x: 90, y: 20, z: 0 });
  });

  it("uses the latest queue call rather than the greatest request ID when saturated", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    for (let id = 10; id <= 12; id += 1) {
      capturer.queue(request(id, id * 10, 50));
      capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100);
      capturer.beginMappings();
    }
    capturer.queue(request(99, 90, 50));
    capturer.queue(request(1, 120, 50));
    gpu.buffers[0].map.resolve();
    await flush();
    capturer.collectResults();

    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100)).toBe(true);
    expect(gpu.copyTextureToBuffer.mock.calls.at(-1)![0].origin).toEqual({ x: 90, y: 20, z: 0 });
  });

  it("converts BGRA rows to RGBA and publishes mappings independently", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "bgra8unorm-srgb");
    for (const [id, centerX] of [[1, 40], [2, 50]] as const) {
      capturer.queue(request(id, centerX, 50));
      capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    }
    gpu.buffers[0].data.set([2, 240, 3, 255]);
    gpu.buffers[1].data.set([9, 8, 7, 6]);
    capturer.beginMappings();
    gpu.buffers[1].map.resolve();
    await flush();
    expect(capturer.collectResults()).toMatchObject([{ requestId: 2, rgba: expect.any(Uint8ClampedArray) }]);
    gpu.buffers[0].map.resolve();
    await flush();
    const [first] = capturer.collectResults();
    expect([...first.rgba.slice(0, 4)]).toEqual([3, 240, 2, 255]);
  });

  it("publishes the canonical inspector region from padded BGRA bytes", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "bgra8unorm-srgb");
    capturer.queue(request(1, 100, 80));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 160);
    // WebGPU rows are padded to 256 bytes and BGRA must become canonical RGBA.
    gpu.buffers[0].data.set([2, 240, 3, 255], 30 * 256 + 30 * 4);
    gpu.buffers[0].data.set([51, 34, 17, 68], 7 * 256 + 5 * 4);
    capturer.beginMappings();
    gpu.buffers[0].map.resolve();
    await flush();

    expectCanonicalRegion(capturer.collectResults()[0]);
  });

  it("converts non-sRGB BGRA readback to RGBA", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "bgra8unorm");
    capturer.queue(request(1));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    gpu.buffers[0].data.set([2, 240, 3, 255]);
    capturer.beginMappings();
    gpu.buffers[0].map.resolve();
    await flush();
    const [result] = capturer.collectResults();
    expect([...result.rgba.slice(0, 4)]).toEqual([3, 240, 2, 255]);
  });

  it("recovers from mapping and encoding failures without leaking or poisoning other slots", async () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    capturer.beginMappings();
    gpu.buffers[0].map.reject(new Error("lost"));
    await flush();
    expect(() => capturer.collectResults()).not.toThrow();
    capturer.queue(request(2));
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100)).toBe(true);
    expect(gpu.buffers[0].destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ["createBuffer", (gpu: ReturnType<typeof mockGpu>) => {
      vi.mocked(gpu.device.createBuffer).mockImplementationOnce(() => {
        throw new Error("lost");
      });
    }],
    ["copyTextureToBuffer", (gpu: ReturnType<typeof mockGpu>) => {
      gpu.copyTextureToBuffer.mockImplementationOnce(() => {
        throw new Error("lost");
      });
    }],
  ])("retries safely when %s throws synchronously", (stage, arrange) => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    arrange(gpu);
    capturer.queue(request(1));
    expect(() => capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100)).not.toThrow();
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100)).toBe(true);
    expect(gpu.copyTextureToBuffer).toHaveBeenCalledTimes(stage === "createBuffer" ? 1 : 2);
  });

  it.each([
    ["mapAsync", (buffer: MockBuffer) => buffer.mapAsync.mockImplementationOnce(() => {
      throw new Error("lost");
    })],
    ["getMappedRange", (buffer: MockBuffer) => buffer.getMappedRange.mockImplementationOnce(() => {
      throw new Error("lost");
    })],
    ["unmap", (buffer: MockBuffer) => buffer.unmap.mockImplementationOnce(() => {
      throw new Error("lost");
    })],
  ])("retries safely when %s throws", async (_stage, arrange) => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    arrange(gpu.buffers[0]);
    expect(() => capturer.beginMappings()).not.toThrow();
    if (gpu.buffers[0].mapAsync.mock.results[0]?.value === gpu.buffers[0].map.promise) {
      gpu.buffers[0].map.resolve();
      await flush();
    }
    expect(() => capturer.collectResults()).not.toThrow();
    expect(gpu.buffers[0].destroy).toHaveBeenCalledOnce();
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100)).toBe(true);
    expect(gpu.buffers).toHaveLength(2);
  });

  it("does not replace a newer intent when an older encode fails", () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    gpu.copyTextureToBuffer.mockImplementationOnce(() => {
      capturer.queue(request(2, 120, 50));
      throw new Error("lost");
    });
    capturer.queue(request(1, 40, 50));
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100)).toBe(false);
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100)).toBe(true);
    expect(gpu.copyTextureToBuffer.mock.calls.at(-1)![0].origin).toEqual({ x: 90, y: 20, z: 0 });
  });

  it.each(["resolve", "reject"] as const)("does not let a late mapping %s mutate a recreated slot", async (lateAction) => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    capturer.beginMappings();
    capturer.cancelPendingCaptures();
    expect(gpu.buffers[0].destroy).toHaveBeenCalledOnce();
    capturer.queue(request(2));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    capturer.beginMappings();
    if (lateAction === "resolve") {
      gpu.buffers[0].map.resolve();
    } else {
      gpu.buffers[0].map.reject(new Error("late"));
    }
    await flush();
    expect(capturer.collectResults()).toEqual([]);
    gpu.buffers[1].map.resolve();
    await flush();
    expect(capturer.collectResults()).toMatchObject([{ requestId: 2 }]);
  });

  it("destroys each buffer once on cancellation and keeps disposal idempotent", () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    capturer.queue(request(1));
    capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100);
    capturer.cancelPendingCaptures();
    expect(gpu.buffers[0].destroy).toHaveBeenCalledOnce();
    capturer.dispose();
    capturer.dispose();
    expect(gpu.buffers[0].destroy).toHaveBeenCalledOnce();
    capturer.dispose();
    expect(capturer.queue(request(3))).toBe(false);
    expect(capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 100, 100)).toBe(false);
  });

  it("releases all three occupied readback buffers when inspector work is cancelled", () => {
    const gpu = mockGpu();
    const capturer = new WebGPUPixelRegionCapturer(gpu.device, "rgba8unorm");
    for (let requestId = 1; requestId <= 3; requestId += 1) {
      capturer.queue(request(requestId, requestId * 10, 50));
      capturer.encodeAfterRender(gpu.encoder, {} as GPUTexture, 200, 100);
      capturer.beginMappings();
    }

    capturer.cancelPendingCaptures();

    expect(gpu.buffers).toHaveLength(3);
    for (const buffer of gpu.buffers) {
      expect(buffer.destroy).toHaveBeenCalledOnce();
    }
  });
});

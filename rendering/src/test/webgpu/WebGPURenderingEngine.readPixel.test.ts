import { describe, it, expect, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

/**
 * Pixel inspector readback. WebGPU readback is asynchronous, so readPixel()
 * follows a request/cache contract: calling it records the wanted coordinate
 * and returns the most recently resolved pixel (null until the first
 * readback completes). render() encodes a 1×1 copy of the canvas texture at
 * the requested coordinate and resolves it via buffer mapping.
 */

interface MockPass {
  getPipeline: () => object;
  getBindGroup: () => object;
  getUniformBuffer: () => object;
  getCurrentOutputView: () => object | null;
  getPreviousOutputView: () => object | null;
  rebuildBindGroup: ReturnType<typeof vi.fn>;
  swap: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function imagePipeline(): MockPass {
  return {
    getPipeline: () => ({ label: "image-pipeline" }),
    getBindGroup: () => ({ label: "image-bind-group" }),
    getUniformBuffer: () => ({ label: "image-uniform" }),
    getCurrentOutputView: () => null,
    getPreviousOutputView: () => null,
    rebuildBindGroup: vi.fn(),
    swap: vi.fn(),
    dispose: vi.fn(),
  };
}

/** Builds an engine with a mocked device whose readback buffer yields `pixelBytes`. */
function engineWithMockedGpu(pixelBytes: number[], format = "bgra8unorm") {
  const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
  const copyTextureToBuffer = vi.fn();
  let mapResolve: (() => void) | null = null;
  const readbackBuffer = {
    mapAsync: vi.fn(() => new Promise<void>((resolve) => {
      mapResolve = resolve;
    })),
    getMappedRange: vi.fn(() => new Uint8Array(pixelBytes).buffer),
    unmap: vi.fn(),
    destroy: vi.fn(),
  };
  const canvasTexture = { label: "canvas-texture", createView: () => ({ label: "canvas" }) };

  (engine as any).device = {
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      })),
      copyTextureToBuffer,
      finish: vi.fn(() => ({})),
    })),
    createBuffer: vi.fn(() => readbackBuffer),
  };
  (engine as any).format = format;
  (engine as any).context = { getCurrentTexture: () => canvasTexture };
  (engine as any).canvas = { width: 320, height: 180 };
  (engine as any).passGraph = [
    { name: "Image", width: 320, height: 180, output: "canvas", channels: [] },
  ];
  (engine as any).passPipelines = new Map([["Image", imagePipeline()]]);

  return {
    engine,
    copyTextureToBuffer,
    readbackBuffer,
    canvasTexture,
    flushMap: async () => {
      mapResolve?.();
      // Let the mapAsync .then chain run
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("WebGPURenderingEngine.readPixel", () => {
  it("returns null before initialization", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    expect(engine.readPixel(1, 1)).toBeNull();
  });

  it("returns null before the first readback resolves", () => {
    const { engine } = engineWithMockedGpu([0, 0, 0, 255]);
    expect(engine.readPixel(10, 20)).toBeNull();
  });

  it("does not encode a copy when no pixel was requested", () => {
    const { engine, copyTextureToBuffer } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.render(1000);
    expect(copyTextureToBuffer).not.toHaveBeenCalled();
  });

  it("encodes a 1×1 canvas-texture copy at the requested coordinate on render", () => {
    const { engine, copyTextureToBuffer, canvasTexture } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.readPixel(10, 20);
    engine.render(1000);

    expect(copyTextureToBuffer).toHaveBeenCalledTimes(1);
    const [src, dst, size] = copyTextureToBuffer.mock.calls[0];
    expect(src.texture).toBe(canvasTexture);
    expect(src.origin).toEqual({ x: 10, y: 20 });
    expect(dst.bytesPerRow).toBe(256);
    expect(size).toEqual({ width: 1, height: 1 });
  });

  it("clamps out-of-bounds coordinates to the canvas", () => {
    const { engine, copyTextureToBuffer } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.readPixel(9999, -5);
    engine.render(1000);

    const [src] = copyTextureToBuffer.mock.calls[0];
    expect(src.origin).toEqual({ x: 319, y: 0 });
  });

  it("resolves the pixel after mapping and swaps BGRA to RGBA", async () => {
    const { engine, flushMap } = engineWithMockedGpu([10, 20, 30, 255], "bgra8unorm");
    engine.readPixel(10, 20);
    engine.render(1000);
    await flushMap();

    expect(engine.readPixel(10, 20)).toEqual({ r: 30, g: 20, b: 10, a: 255 });
  });

  it("returns RGBA untouched for rgba8unorm canvases", async () => {
    const { engine, flushMap } = engineWithMockedGpu([10, 20, 30, 255], "rgba8unorm");
    engine.readPixel(10, 20);
    engine.render(1000);
    await flushMap();

    expect(engine.readPixel(10, 20)).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });

  it("does not start a second copy while a readback is still mapping", () => {
    const { engine, copyTextureToBuffer } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.readPixel(10, 20);
    engine.render(1000);
    engine.render(1001);

    expect(copyTextureToBuffer).toHaveBeenCalledTimes(1);
  });

  it("issues a fresh copy once the previous readback resolved", async () => {
    const { engine, copyTextureToBuffer, flushMap } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.readPixel(10, 20);
    engine.render(1000);
    await flushMap();
    engine.render(1001);

    expect(copyTextureToBuffer).toHaveBeenCalledTimes(2);
  });

  it("unmaps the readback buffer after reading", async () => {
    const { engine, readbackBuffer, flushMap } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.readPixel(10, 20);
    engine.render(1000);
    await flushMap();

    expect(readbackBuffer.unmap).toHaveBeenCalledTimes(1);
  });

  it("destroys the readback buffer on dispose", async () => {
    const { engine, readbackBuffer, flushMap } = engineWithMockedGpu([0, 0, 0, 255]);
    engine.readPixel(10, 20);
    engine.render(1000);
    await flushMap();
    engine.dispose();

    expect(readbackBuffer.destroy).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { WebGPUPixelRegionCapturer } from "../../webgpu/WebGPUPixelRegionCapturer";
import type { PixelRegionResult } from "../../types/PixelRegion";
import { expectCanonicalRegion } from "../capture/canonicalPixelRegion";

interface CapturerDouble {
  queue: ReturnType<typeof vi.fn>;
  collectResults: ReturnType<typeof vi.fn>;
  cancelPendingCaptures: ReturnType<typeof vi.fn>;
  encodeAfterRender: ReturnType<typeof vi.fn>;
  beginMappings: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function capturer(): CapturerDouble {
  return {
    queue: vi.fn(() => true),
    collectResults: vi.fn((): PixelRegionResult[] => []),
    cancelPendingCaptures: vi.fn(),
    encodeAfterRender: vi.fn(() => false),
    beginMappings: vi.fn(),
    dispose: vi.fn(),
  };
}

function engineWithCanvasPass() {
  const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
  const events: string[] = [];
  const readbackBuffers: Array<{ data: Uint8Array; mapAsync: () => Promise<void>; getMappedRange: () => ArrayBuffer; unmap: () => void; destroy: () => void }> = [];
  const canvasTexture = { createView: () => ({}) } as unknown as GPUTexture;
  const device = {
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(() => events.push("submit")),
    },
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn(() => events.push("end")),
      })),
      copyTextureToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    createBuffer: vi.fn((desc: { size: number }) => {
      const data = new Uint8Array(desc.size);
      const buffer = {
        data,
        mapAsync: () => Promise.resolve(),
        getMappedRange: () => data.buffer,
        unmap: () => {},
        destroy: () => {},
      };
      readbackBuffers.push(buffer);
      return buffer;
    }),
  };
  const pipeline = {
    getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}),
    getCurrentOutputView: () => null, rebuildBindGroup: vi.fn(), swap: vi.fn(), dispose: vi.fn(),
  };
  Object.assign(engine as unknown as Record<string, unknown>, {
    device, context: { getCurrentTexture: () => canvasTexture }, canvas: { width: 320, height: 180 },
    passGraph: [{ name: "Image", width: 320, height: 180, output: "canvas", channels: [] }],
    passPipelines: new Map([["Image", pipeline]]),
  });
  return { engine, canvasTexture, events, device, readbackBuffers };
}

describe("WebGPURenderingEngine pixel regions", () => {
  it("has safe pixel-region defaults before initialization", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    expect(engine.requestPixelRegion(1, 10, 20)).toBe(false);
    expect(engine.collectPixelRegionResults()).toEqual([]);
    expect(() => engine.cancelPixelRegionRequests()).not.toThrow();
  });

  it("delegates requests, results, and cancellation to the region capturer", () => {
    const { engine } = engineWithCanvasPass();
    const double = capturer();
    Object.assign(engine as unknown as Record<string, unknown>, { pixelRegionCapturer: double });
    const result: PixelRegionResult = { requestId: 3, centerX: 4, centerY: 5, width: 60, height: 60, rgba: new Uint8ClampedArray() };
    double.collectResults.mockReturnValue([result]);

    expect(engine.requestPixelRegion(3, 4.9, 5.1)).toBe(true);
    expect(double.queue).toHaveBeenCalledWith({ requestId: 3, centerX: 4, centerY: 5 });
    expect(engine.collectPixelRegionResults()).toEqual([result]);
    engine.cancelPixelRegionRequests();
    expect(double.cancelPendingCaptures).toHaveBeenCalledOnce();
  });

  it("encodes after the canvas pass, then submits and begins mappings", () => {
    const { engine, canvasTexture, events } = engineWithCanvasPass();
    const double = capturer();
    double.encodeAfterRender.mockImplementation(() => {
      events.push("copy"); return true;
    });
    double.beginMappings.mockImplementation(() => events.push("map"));
    Object.assign(engine as unknown as Record<string, unknown>, { pixelRegionCapturer: double });

    engine.render(1000);

    expect(double.encodeAfterRender).toHaveBeenCalledWith(expect.anything(), canvasTexture, 320, 180);
    expect(events).toEqual(["end", "copy", "submit", "map"]);
  });

  it("uses capture-time canvas dimensions for a request queued before resize", () => {
    const { engine, canvasTexture } = engineWithCanvasPass();
    const double = capturer();
    Object.assign(engine as unknown as Record<string, unknown>, { pixelRegionCapturer: double });

    expect(engine.requestPixelRegion(1, 100, 80)).toBe(true);
    expect(double.queue).toHaveBeenCalledWith({ requestId: 1, centerX: 100, centerY: 80 });
    const canvas = (engine as unknown as { canvas: { width: number; height: number } }).canvas;
    canvas.width = 200;
    canvas.height = 160;

    engine.render(1000);

    expect(double.encodeAfterRender).toHaveBeenCalledWith(expect.anything(), canvasTexture, 200, 160);
  });

  it("captures a queued request using resized live dimensions through the engine", async () => {
    const { engine, device, readbackBuffers } = engineWithCanvasPass();
    const realCapturer = new WebGPUPixelRegionCapturer(device as unknown as GPUDevice, "bgra8unorm-srgb");
    Object.assign(engine as unknown as Record<string, unknown>, { pixelRegionCapturer: realCapturer });
    const canvas = (engine as unknown as { canvas: { width: number; height: number } }).canvas;
    expect(engine.requestPixelRegion(1, 100, 80)).toBe(true);
    canvas.width = 200;
    canvas.height = 160;

    engine.render(1000);
    readbackBuffers[0].data.set([2, 240, 3, 255], 30 * 256 + 30 * 4);
    readbackBuffers[0].data.set([51, 34, 17, 68], 7 * 256 + 5 * 4);
    await Promise.resolve();
    await Promise.resolve();

    expectCanonicalRegion(engine.collectPixelRegionResults()[0]);
  });

  it("cancels on cleanup and disposes the capturer before destroying the device", () => {
    const { engine, events } = engineWithCanvasPass();
    const double = capturer();
    const device = (engine as unknown as { device: { destroy?: () => void } }).device;
    device.destroy = () => events.push("destroy");
    double.dispose.mockImplementation(() => events.push("dispose"));
    Object.assign(engine as unknown as Record<string, unknown>, { pixelRegionCapturer: double });

    engine.cleanup();
    expect(double.cancelPendingCaptures).toHaveBeenCalledOnce();
    engine.dispose();
    expect(events).toContain("dispose");
    expect(events.indexOf("dispose")).toBeLessThan(events.indexOf("destroy"));
  });
});

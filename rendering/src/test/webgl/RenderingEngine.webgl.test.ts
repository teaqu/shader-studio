import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { piCreateGlContext } from "../../../../vendor/pilibs/src/piWebUtils";
import { FrameRenderer } from "../../webgl/FrameRenderer";

const capturerState = vi.hoisted(() => ({
  instances: [] as Array<{
    captureAfterRender: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../../../../vendor/pilibs/src/piWebUtils", () => ({
  piCreateGlContext: vi.fn(),
}));

vi.mock("../../../../vendor/pilibs/src/piRenderer", () => ({
  piRenderer: vi.fn(() => ({ Initialize: vi.fn() })),
}));

vi.mock("../../resources/ResourceManager", () => ({
  ResourceManager: class {},
}));

vi.mock("../../webgl/BufferManager", () => ({
  BufferManager: class {},
}));

vi.mock("../../webgl/WebGLRenderLimits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../webgl/WebGLRenderLimits")>();
  return {
    ...actual,
    getWebGLRenderLimits: vi.fn(() => ({ maxWidth: 4096, maxHeight: 4096 })),
  };
});

vi.mock("../../webgl/WebGLPixelRegionCapturer", () => ({
  WebGLPixelRegionCapturer: class {
    captureAfterRender = vi.fn();
    dispose = vi.fn();

    constructor() {
      capturerState.instances.push(this);
    }
  },
}));

const mockPiCreateGlContext = vi.mocked(piCreateGlContext);

describe("RenderingEngine WebGL Initialization", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockPiCreateGlContext.mockReset();
    capturerState.instances.length = 0;
  });

  describe("piCreateGlContext usage", () => {
    it("should request a depth buffer for mesh Image passes", async () => {
      const mockGL = {} as any;
      const mockCanvas = { addEventListener: vi.fn() } as any;
      mockPiCreateGlContext.mockReturnValue(mockGL);

      // Dynamic import so vi.mock is applied before module loads
      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();

      try {
        engine.initialize(mockCanvas);
      } catch { /* piRenderer init may fail, that's OK */ }

      expect(mockPiCreateGlContext).toHaveBeenCalledWith(
        mockCanvas,
        false, // useAlpha
        true, // useDepth
        false, // usePreserveBuffer (default)
        false, // useSupersampling
      );
    });

    it("should pass preserveDrawingBuffer to piCreateGlContext", async () => {
      const mockGL = {} as any;
      const mockCanvas = { addEventListener: vi.fn() } as any;
      mockPiCreateGlContext.mockReturnValue(mockGL);

      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();

      try {
        engine.initialize(mockCanvas, true);
      } catch { /* piRenderer init may fail */ }

      expect(mockPiCreateGlContext).toHaveBeenCalledWith(
        mockCanvas,
        false, // useAlpha
        true, // useDepth
        true,  // usePreserveBuffer
        false, // useSupersampling
      );
    });

    it("should throw when piCreateGlContext returns null", async () => {
      const mockCanvas = { addEventListener: vi.fn() } as any;
      mockPiCreateGlContext.mockReturnValue(null);

      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();

      expect(() => engine.initialize(mockCanvas)).toThrow("WebGL2 not supported");
    });

    it("registers a region capturer callback that uses the live canvas size", async () => {
      const mockGL = { getExtension: vi.fn() } as unknown as WebGL2RenderingContext;
      const mockCanvas = {
        addEventListener: vi.fn(),
        getContext: vi.fn(() => mockGL),
        width: 320,
        height: 180,
      } as unknown as HTMLCanvasElement;
      mockPiCreateGlContext.mockReturnValue(mockGL);
      const setPostImageCallback = vi.spyOn(FrameRenderer.prototype, "setPostImageCallback");

      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();
      engine.initialize(mockCanvas);

      const callback = setPostImageCallback.mock.calls[0]?.[0];
      mockCanvas.width = 640;
      mockCanvas.height = 360;
      callback?.();

      expect(capturerState.instances).toHaveLength(1);
      expect(capturerState.instances[0].captureAfterRender).toHaveBeenCalledWith(640, 360);
    });

    it("wires FrameRenderer's GPU time source to its own gpuFrameMs", async () => {
      const mockGL = { getExtension: vi.fn() } as unknown as WebGL2RenderingContext;
      const mockCanvas = {
        addEventListener: vi.fn(),
        getContext: vi.fn(() => mockGL),
        width: 320,
        height: 180,
      } as unknown as HTMLCanvasElement;
      mockPiCreateGlContext.mockReturnValue(mockGL);
      const setGpuFrameTimeSource = vi.spyOn(FrameRenderer.prototype, "setGpuFrameTimeSource");

      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();
      engine.initialize(mockCanvas);

      const source = setGpuFrameTimeSource.mock.calls[0]?.[0];
      (engine as any).gpuFrameMs = 33.3;
      expect(source?.()).toBe(33.3);
    });

    it("disposes the prior capturer before a failed reinitialization", async () => {
      const mockGL = { getExtension: vi.fn() } as unknown as WebGL2RenderingContext;
      const firstCanvas = {
        addEventListener: vi.fn(),
        getContext: vi.fn(() => mockGL),
        width: 320,
        height: 180,
      } as unknown as HTMLCanvasElement;
      const secondCanvas = {
        addEventListener: vi.fn(),
        getContext: vi.fn(() => mockGL),
        width: 640,
        height: 360,
      } as unknown as HTMLCanvasElement;
      mockPiCreateGlContext.mockReturnValueOnce(mockGL).mockReturnValueOnce(null);
      const setPostImageCallback = vi.spyOn(FrameRenderer.prototype, "setPostImageCallback");
      const stopRenderLoop = vi.spyOn(FrameRenderer.prototype, "stopRenderLoop");

      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();
      engine.initialize(firstCanvas);

      expect(() => engine.initialize(secondCanvas)).toThrow("WebGL2 not supported");
      expect(capturerState.instances).toHaveLength(1);
      expect(capturerState.instances[0].dispose).toHaveBeenCalledOnce();
      expect(setPostImageCallback).toHaveBeenLastCalledWith(null);
      expect(stopRenderLoop).toHaveBeenCalledOnce();
    });

    it("detaches the old renderer before a successful reinitialization", async () => {
      const firstGL = { getExtension: vi.fn() } as unknown as WebGL2RenderingContext;
      const secondGL = { getExtension: vi.fn() } as unknown as WebGL2RenderingContext;
      const firstCanvas = {
        addEventListener: vi.fn(),
        getContext: vi.fn(() => firstGL),
        width: 320,
        height: 180,
      } as unknown as HTMLCanvasElement;
      const secondCanvas = {
        addEventListener: vi.fn(),
        getContext: vi.fn(() => secondGL),
        width: 640,
        height: 360,
      } as unknown as HTMLCanvasElement;
      mockPiCreateGlContext.mockReturnValueOnce(firstGL).mockReturnValueOnce(secondGL);
      const setPostImageCallback = vi.spyOn(FrameRenderer.prototype, "setPostImageCallback");
      const stopRenderLoop = vi.spyOn(FrameRenderer.prototype, "stopRenderLoop");

      const { RenderingEngine } = await import("../../webgl/RenderingEngine");
      const engine = new RenderingEngine();
      engine.initialize(firstCanvas);
      const oldCallback = setPostImageCallback.mock.calls[0]?.[0];
      engine.initialize(secondCanvas);
      const newCallback = setPostImageCallback.mock.calls.at(-1)?.[0];

      oldCallback?.();
      secondCanvas.width = 800;
      secondCanvas.height = 450;
      newCallback?.();

      expect(setPostImageCallback).toHaveBeenNthCalledWith(2, null);
      expect(stopRenderLoop).toHaveBeenCalledOnce();
      expect(capturerState.instances).toHaveLength(2);
      expect(capturerState.instances[0].dispose).toHaveBeenCalledOnce();
      expect(capturerState.instances[1].captureAfterRender).toHaveBeenCalledWith(800, 450);
      expect(capturerState.instances[1].captureAfterRender).toHaveBeenCalledOnce();
    });
  });
});

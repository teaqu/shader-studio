import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { piCreateGlContext } from "../../../vendor/pilibs/src/piWebUtils";

vi.mock("../../../vendor/pilibs/src/piWebUtils", () => ({
  piCreateGlContext: vi.fn(),
}));

const mockPiCreateGlContext = vi.mocked(piCreateGlContext);

describe("RenderingEngine WebGL Initialization", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockPiCreateGlContext.mockReset();
  });

  describe("piCreateGlContext usage", () => {
    it("should call piCreateGlContext with alpha disabled", async () => {
      const mockGL = {} as any;
      const mockCanvas = { addEventListener: vi.fn() } as any;
      mockPiCreateGlContext.mockReturnValue(mockGL);

      // Dynamic import so vi.mock is applied before module loads
      const { RenderingEngine } = await import("../RenderingEngine");
      const engine = new RenderingEngine();

      try { engine.initialize(mockCanvas); } catch { /* piRenderer init may fail, that's OK */ }

      expect(mockPiCreateGlContext).toHaveBeenCalledWith(
        mockCanvas,
        false, // useAlpha
        false, // useDepth
        false, // usePreserveBuffer (default)
        false, // useSupersampling
      );
    });

    it("should pass preserveDrawingBuffer to piCreateGlContext", async () => {
      const mockGL = {} as any;
      const mockCanvas = { addEventListener: vi.fn() } as any;
      mockPiCreateGlContext.mockReturnValue(mockGL);

      const { RenderingEngine } = await import("../RenderingEngine");
      const engine = new RenderingEngine();

      try { engine.initialize(mockCanvas, true); } catch { /* piRenderer init may fail */ }

      expect(mockPiCreateGlContext).toHaveBeenCalledWith(
        mockCanvas,
        false, // useAlpha
        false, // useDepth
        true,  // usePreserveBuffer
        false, // useSupersampling
      );
    });

    it("should throw when piCreateGlContext returns null", async () => {
      const mockCanvas = { addEventListener: vi.fn() } as any;
      mockPiCreateGlContext.mockReturnValue(null);

      const { RenderingEngine } = await import("../RenderingEngine");
      const engine = new RenderingEngine();

      expect(() => engine.initialize(mockCanvas)).toThrow("WebGL2 not supported");
    });
  });
});

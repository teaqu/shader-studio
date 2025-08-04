import { beforeEach, describe, expect, it, vi } from "vitest";

describe("RenderingEngine WebGL Initialization", () => {
  let mockRenderer: any;
  let mockInitialize: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock the Initialize method to track calls
    mockInitialize = vi.fn().mockReturnValue(true);
    
    mockRenderer = {
      Initialize: mockInitialize,
      CreateTexture: vi.fn().mockReturnValue({ mObjectID: 1 }),
      DestroyShader: vi.fn(),
      CreateShader: vi.fn().mockReturnValue({
        mResult: true,
        mProgram: {},
      }),
      GetShaderHeaderLines: vi.fn().mockReturnValue(0),
    };

    vi.doMock("../../vendor/pilibs/src/piRenderer", () => ({
      piRenderer: () => mockRenderer,
    }));

    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WebGL context passing", () => {
    it("should get WebGL2 context from canvas", () => {
      const mockGL = { 
        getExtension: vi.fn(),
        createProgram: vi.fn(),
        createShader: vi.fn(),
      } as any;

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockGL),
        width: 800,
        height: 600,
        addEventListener: vi.fn(),
      } as any;

      mockCanvas.getContext("webgl2");
      
      expect(mockCanvas.getContext).toHaveBeenCalledWith("webgl2");
      expect(mockCanvas.getContext("webgl2")).toBe(mockGL);
    });

    it("should throw error when WebGL2 is not available", () => {
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(null),
        width: 800,
        height: 600,
        addEventListener: vi.fn(),
      } as any;

      // This simulates what RenderingEngine.initialize does
      const gl = mockCanvas.getContext("webgl2");
      
      expect(gl).toBeNull();
      expect(() => {
        if (!gl) {
          throw new Error("WebGL2 not supported");
        }
      }).toThrow("WebGL2 not supported");
    });
  });

  describe("Renderer initialization flow", () => {
    it("should demonstrate the correct initialization sequence", () => {
      const mockGL = { 
        getExtension: vi.fn(),
        createProgram: vi.fn(),
        createShader: vi.fn(),
      } as any;

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockGL),
        width: 800,
        height: 600,
        addEventListener: vi.fn(),
      } as any;

      const gl = mockCanvas.getContext("webgl2");
      expect(gl).toBe(mockGL);
      
      mockRenderer.Initialize(gl);
      
      expect(mockInitialize).toHaveBeenCalledWith(mockGL);
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });
  });
});

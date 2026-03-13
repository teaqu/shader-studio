import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../RenderingEngine";
import { ConfigValidator } from "../util/ConfigValidator";
import type { ShaderConfig } from "@shader-studio/types";

// Mock the ConfigValidator
vi.mock("../util/ConfigValidator", () => ({
  ConfigValidator: {
    validateConfig: vi.fn()
  }
}));

describe("RenderingEngine", () => {
  let renderingEngine: RenderingEngine;
  let mockFrameRenderer: any;

  beforeEach(() => {
    renderingEngine = new RenderingEngine();
    vi.spyOn(console, "log").mockImplementation(() => { });

    mockFrameRenderer = {
      startRenderLoop: vi.fn(),
      stopRenderLoop: vi.fn(),
      setFPSLimit: vi.fn(),
    };

    Object.defineProperty(renderingEngine, 'frameRenderer', {
      value: mockFrameRenderer,
      writable: true,
      configurable: true
    });
  });

  describe("config validation", () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
      };
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: { getCurrentTime: vi.fn().mockReturnValue(0), isPaused: vi.fn().mockReturnValue(false) },
        writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: { syncAllVideosToTime: vi.fn(), pauseAllVideos: vi.fn(), resumeAllVideos: vi.fn(), syncAllAudioToTime: vi.fn(), pauseAllAudio: vi.fn(), resumeAllAudio: vi.fn(), muteAllAudio: vi.fn(), unmuteAllAudio: vi.fn() },
        writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should validate config before processing", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });

      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        config,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).toHaveBeenCalledWith(config);
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });

    it("should reject compilation when config validation fails", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({
        isValid: false,
        errors: ['Test validation error']
      });

      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      const result = await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        config,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).toHaveBeenCalledWith(config);
      expect(result!.success).toBe(false);
      expect(result!.errors![0]).toContain('Invalid shader configuration: Test validation error');
      expect(mockPipeline.compileShaderPipeline).not.toHaveBeenCalled();
    });

    it("should not validate null config", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);

      await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        null,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).not.toHaveBeenCalled();
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });
  });

  describe('Buffer Update Tests', () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        getPasses: vi.fn(() => [
          { name: 'Image', shaderSrc: 'void main() {}' },
          { name: 'BufferA', shaderSrc: 'original buffer content' }
        ]),
        getShaderPath: vi.fn(() => 'test.glsl')
      };


      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: { getCurrentTime: vi.fn().mockReturnValue(0), isPaused: vi.fn().mockReturnValue(false) },
        writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: { syncAllVideosToTime: vi.fn(), pauseAllVideos: vi.fn(), resumeAllVideos: vi.fn(), syncAllAudioToTime: vi.fn(), pauseAllAudio: vi.fn(), resumeAllAudio: vi.fn(), muteAllAudio: vi.fn(), unmuteAllAudio: vi.fn() },
        writable: true, configurable: true,
      });

      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });

      vi.clearAllMocks();
    });

    it('should return current config via getCurrentConfig', () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Set the config by calling compileShaderPipeline
      renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        {}
      );

      const currentConfig = renderingEngine.getCurrentConfig();
      expect(currentConfig).toEqual(testConfig);
    });

    it('should update buffer and recompile via updateBufferAndRecompile', async () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Initialize with a config
      await renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        { BufferA: 'original buffer content' }
      );

      // Mock the pipeline compilation for buffer update
      const mockCompileResult = { success: true };
      mockPipeline.compileShaderPipeline.mockResolvedValue(mockCompileResult);

      // Update buffer
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'updated buffer content'
      );

      expect(result).toEqual({ success: true });
      
      // Check the second call (buffer update) specifically
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(2);
      const bufferUpdateCall = mockPipeline.compileShaderPipeline.mock.calls[1];
      expect(bufferUpdateCall).toEqual([
        'void main() {}', // imagePass.shaderSrc
        testConfig,
        'test.glsl',
        { BufferA: 'updated buffer content' }, // updated buffers
        undefined, // audioOptions
      ]);
    });

    it('should handle buffer update compilation failure', async () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Initialize with a config
      await renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        { BufferA: 'original content' }
      );

      // Mock compilation failure
      const mockCompileResult = {
        success: false,
        errors: ['Buffer compilation failed']
      };
      mockPipeline.compileShaderPipeline.mockResolvedValue(mockCompileResult);

      // Update buffer
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'broken buffer content'
      );

      expect(result).toEqual({
        success: false,
        errors: ['Buffer compilation failed']
      });
    });

    it('should handle buffer update when no config is set', async () => {
      // Don't initialize with any config - but set up mock pipeline
      mockPipeline.getPasses.mockReturnValue([]);
      
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'some content'
      );

      expect(result).toEqual({
        success: false,
        errors: ["Buffer 'BufferA' not found in current shader"]
      });
    });
  });

  describe("FPS limiting", () => {
    it("should delegate setFPSLimit to FrameRenderer", () => {
      renderingEngine.setFPSLimit(30);
      expect(mockFrameRenderer.setFPSLimit).toHaveBeenCalledWith(30);
    });
  });

  describe("video sync on compilation", () => {
    let mockPipeline: any;
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
      };
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync and resume videos on successful compilation when not paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(7.5);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(7.5);
      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
    });

    it("should sync and pause videos on successful compilation when paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(3.0);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(3.0);
      expect(mockResourceManager.pauseAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });

    it("should pause all videos on failed compilation", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: false, error: "syntax error" });

      await renderingEngine.compileShaderPipeline("bad code", null, "test.glsl", {});

      expect(mockResourceManager.pauseAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.syncAllVideosToTime).not.toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });
  });

  describe("video sync on togglePause", () => {
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync videos and pause them when pausing shader", () => {
      // Was not paused -> toggling will pause
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(10.0);

      renderingEngine.togglePause();

      expect(mockTimeManager.togglePause).toHaveBeenCalled();
      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(10.0);
      expect(mockResourceManager.pauseAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });

    it("should sync videos and resume them when unpausing shader", () => {
      // Was paused -> toggling will unpause
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(2.0);

      renderingEngine.togglePause();

      expect(mockTimeManager.togglePause).toHaveBeenCalled();
      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(2.0);
      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
    });
  });

  describe("readPixel", () => {
    it("should return null when canvas is not initialized", () => {
      const result = renderingEngine.readPixel(0, 0);
      expect(result).toBeNull();
    });

    it("should return null when WebGL context is not available", () => {
      const mockCanvas = document.createElement("canvas");
      mockCanvas.getContext = vi.fn().mockReturnValue(null);

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: mockCanvas,
        writable: true,
        configurable: true,
      });

      const result = renderingEngine.readPixel(0, 0);
      expect(result).toBeNull();
    });

    it("should read pixel data correctly", () => {
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 100;
      mockCanvas.height = 100;

      const mockGl = {
        readPixels: vi.fn().mockImplementation(
          (x: number, y: number, width: number, height: number, format: number, type: number, pixels: Uint8Array) => {
            pixels[0] = 255; // R
            pixels[1] = 128; // G
            pixels[2] = 64;  // B
            pixels[3] = 255; // A
          }
        ),
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
      };

      mockCanvas.getContext = vi.fn().mockReturnValue(mockGl);

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: mockCanvas,
        writable: true,
        configurable: true,
      });

      const result = renderingEngine.readPixel(50, 30);

      expect(result).toEqual({
        r: 255,
        g: 128,
        b: 64,
        a: 255,
      });
    });

    it("should flip Y coordinate for WebGL (bottom-left origin)", () => {
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 100;
      mockCanvas.height = 100;

      const mockGl = {
        readPixels: vi.fn(),
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
      };

      mockCanvas.getContext = vi.fn().mockReturnValue(mockGl);

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: mockCanvas,
        writable: true,
        configurable: true,
      });

      // Read at y=30 on a 100px tall canvas
      // Should flip to glY = 100 - 30 - 1 = 69
      renderingEngine.readPixel(50, 30);

      expect(mockGl.readPixels).toHaveBeenCalledWith(
        50,    // x
        69,    // flipped y (100 - 30 - 1)
        1,     // width
        1,     // height
        mockGl.RGBA,
        mockGl.UNSIGNED_BYTE,
        expect.any(Uint8Array)
      );
    });
  });

  describe("resetTime", () => {
    it("should delegate to shaderPipeline.resetTime", () => {
      const mockPipeline = {
        resetTime: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });

      renderingEngine.resetTime();

      expect(mockPipeline.resetTime).toHaveBeenCalledTimes(1);
    });
  });

  describe("audio sync on compilation", () => {
    let mockPipeline: any;
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
      };
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync and resume audio on successful compilation when not paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(7.5);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(7.5);
      expect(mockResourceManager.resumeAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllAudio).not.toHaveBeenCalled();
    });

    it("should sync and pause audio on successful compilation when paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(3.0);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(3.0);
      expect(mockResourceManager.pauseAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
    });

    it("should pause all audio on failed compilation", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: false, error: "syntax error" });

      await renderingEngine.compileShaderPipeline("bad code", null, "test.glsl", {});

      expect(mockResourceManager.pauseAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.syncAllAudioToTime).not.toHaveBeenCalled();
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
    });

    it("should pass audioOptions to shaderPipeline.compileShaderPipeline", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);

      const audioOptions = { muted: true, volume: 0.5 };
      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {}, audioOptions);

      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledWith(
        "void mainImage() {}",
        null,
        "test.glsl",
        {},
        audioOptions,
      );
    });
  });

  describe("audio sync on togglePause", () => {
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync audio and pause it when pausing shader", () => {
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(10.0);

      renderingEngine.togglePause();

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(10.0);
      expect(mockResourceManager.pauseAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
    });

    it("should sync audio and resume it when unpausing shader", () => {
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(2.0);

      renderingEngine.togglePause();

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(2.0);
      expect(mockResourceManager.resumeAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllAudio).not.toHaveBeenCalled();
    });
  });

  describe("resumeAudioContext", () => {
    it("should delegate to resourceManager.resumeAudioContext", async () => {
      const mockResourceManager = {
        resumeAudioContext: vi.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      await renderingEngine.resumeAudioContext();

      expect(mockResourceManager.resumeAudioContext).toHaveBeenCalledTimes(1);
    });
  });

  describe("controlVideo", () => {
    let mockResourceManager: any;

    beforeEach(() => {
      mockResourceManager = {
        controlVideo: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
    });

    it("should delegate play action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "play");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "play");
    });

    it("should delegate pause action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "pause");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "pause");
    });

    it("should delegate mute action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "mute");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "mute");
    });

    it("should delegate unmute action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "unmute");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "unmute");
    });

    it("should delegate reset action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "reset");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "reset");
    });
  });

  describe("getVideoState", () => {
    it("should delegate to resourceManager.getVideoState", () => {
      const mockState = { paused: false, muted: true, currentTime: 5.0, duration: 120.0 };
      const mockResourceManager = {
        getVideoState: vi.fn().mockReturnValue(mockState),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getVideoState("video.mp4");

      expect(mockResourceManager.getVideoState).toHaveBeenCalledWith("video.mp4");
      expect(result).toEqual(mockState);
    });

    it("should return null when video is not found", () => {
      const mockResourceManager = {
        getVideoState: vi.fn().mockReturnValue(null),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getVideoState("nonexistent.mp4");
      expect(result).toBeNull();
    });
  });

  describe("controlAudio", () => {
    let mockResourceManager: any;

    beforeEach(() => {
      mockResourceManager = {
        controlAudio: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
    });

    it("should delegate play action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "play");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "play");
    });

    it("should delegate pause action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "pause");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "pause");
    });

    it("should delegate mute action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "mute");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "mute");
    });

    it("should delegate unmute action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "unmute");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "unmute");
    });

    it("should delegate reset action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "reset");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "reset");
    });
  });

  describe("getAudioState", () => {
    it("should delegate to resourceManager.getAudioState", () => {
      const mockState = { paused: false, muted: false, currentTime: 10.0, duration: 200.0 };
      const mockResourceManager = {
        getAudioState: vi.fn().mockReturnValue(mockState),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioState("music.mp3");

      expect(mockResourceManager.getAudioState).toHaveBeenCalledWith("music.mp3");
      expect(result).toEqual(mockState);
    });

    it("should return null when audio is not found", () => {
      const mockResourceManager = {
        getAudioState: vi.fn().mockReturnValue(null),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioState("nonexistent.mp3");
      expect(result).toBeNull();
    });
  });

  describe("seekAudio", () => {
    it("should delegate to resourceManager.seekAudio", () => {
      const mockResourceManager = {
        seekAudio: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.seekAudio("music.mp3", 15.5);

      expect(mockResourceManager.seekAudio).toHaveBeenCalledWith("music.mp3", 15.5);
    });
  });

  describe("updateAudioLoopRegion", () => {
    it("should delegate to resourceManager.updateAudioLoopRegion with both times", () => {
      const mockResourceManager = {
        updateAudioLoopRegion: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.updateAudioLoopRegion("music.mp3", 5.0, 30.0);

      expect(mockResourceManager.updateAudioLoopRegion).toHaveBeenCalledWith("music.mp3", 5.0, 30.0);
    });

    it("should delegate with undefined times", () => {
      const mockResourceManager = {
        updateAudioLoopRegion: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.updateAudioLoopRegion("music.mp3");

      expect(mockResourceManager.updateAudioLoopRegion).toHaveBeenCalledWith("music.mp3", undefined, undefined);
    });
  });

  describe("getAudioFFTData", () => {
    it("should return FFT data for audio type with path", () => {
      const mockFFTData = new Uint8Array([10, 20, 30]);
      const mockResourceManager = {
        getAudioFFTData: vi.fn().mockReturnValue(mockFFTData),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioFFTData("audio", "music.mp3");

      expect(mockResourceManager.getAudioFFTData).toHaveBeenCalledWith("music.mp3");
      expect(result).toBe(mockFFTData);
    });

    it("should return null for non-audio type", () => {
      const mockResourceManager = {
        getAudioFFTData: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioFFTData("video");

      expect(mockResourceManager.getAudioFFTData).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("should return null for audio type without path", () => {
      const mockResourceManager = {
        getAudioFFTData: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioFFTData("audio");

      expect(mockResourceManager.getAudioFFTData).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("setGlobalVolume", () => {
    it("should only mute audio when muted, not touch video state", () => {
      const mockResourceMgr = {
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
        muteAllVideos: vi.fn(),
        unmuteAllVideos: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceMgr, writable: true, configurable: true,
      });

      renderingEngine.setGlobalVolume(0.8, true);

      expect(mockResourceMgr.muteAllAudio).toHaveBeenCalled();
      expect(mockResourceMgr.muteAllVideos).not.toHaveBeenCalled();
      expect(mockResourceMgr.unmuteAllVideos).not.toHaveBeenCalled();
    });

    it("should only unmute audio when unmuted, not touch video state", () => {
      const mockResourceMgr = {
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
        muteAllVideos: vi.fn(),
        unmuteAllVideos: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceMgr, writable: true, configurable: true,
      });

      renderingEngine.setGlobalVolume(0.8, false);

      expect(mockResourceMgr.unmuteAllAudio).toHaveBeenCalledWith(0.8);
      expect(mockResourceMgr.muteAllVideos).not.toHaveBeenCalled();
      expect(mockResourceMgr.unmuteAllVideos).not.toHaveBeenCalled();
    });
  });
});

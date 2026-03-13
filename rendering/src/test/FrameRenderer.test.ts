import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameRenderer } from "../FrameRenderer";

// Mock dependencies
vi.mock("../util/TimeManager");
vi.mock("../input/KeyboardManager");
vi.mock("../input/MouseManager");
vi.mock("../ShaderPipeline");
vi.mock("../BufferManager");
vi.mock("../PassRenderer");
vi.mock("../util/FPSCalculator");

describe("FrameRenderer", () => {
  let frameRenderer: FrameRenderer;
  let mockTimeManager: any;
  let mockKeyboardManager: any;
  let mockMouseManager: any;
  let mockShaderPipeline: any;
  let mockBufferManager: any;
  let mockPassRenderer: any;
  let mockResourceManager: any;
  let mockCanvas: HTMLCanvasElement;
  let mockFPSCalculator: any;

  beforeEach(() => {
    // Create mocks
    mockTimeManager = {
      updateFrame: vi.fn(),
      getDeltaTime: vi.fn(),
      getFrame: vi.fn(),
      isPaused: vi.fn(() => false),
      getCurrentTime: vi.fn(() => 1.0),
      getCurrentDate: vi.fn(() => new Float32Array([2025, 6, 27, 12345])),
      incrementFrame: vi.fn(),
    };

    mockKeyboardManager = {
      clearPressed: vi.fn(),
    };

    mockMouseManager = {
      getMouse: vi.fn(() => new Float32Array([0, 0, 0, 0])),
    };

    mockShaderPipeline = {
      getPasses: vi.fn(() => []),
      getPassShaders: vi.fn(() => ({})),
      getPassShader: vi.fn(() => null),
    };

    mockBufferManager = {
      getPassBuffers: vi.fn(() => ({})),
    };

    mockPassRenderer = {
      renderPass: vi.fn(),
      clearCanvas: vi.fn(),
    };

    mockResourceManager = {
      updateAudioTextures: vi.fn(),
      getAudioSampleRate: vi.fn(() => 44100),
      getAudioState: vi.fn(() => null),
      getVideoElement: vi.fn(() => undefined),
      getImageTextureCache: vi.fn(() => ({})),
      getKeyboardTexture: vi.fn(() => null),
    };

    mockFPSCalculator = {
      reset: vi.fn(),
      updateFrame: vi.fn(),
      getFPS: vi.fn(() => 60),
      getRawFPS: vi.fn(() => 60),
    };

    mockCanvas = {
      width: 800,
      height: 600,
    } as HTMLCanvasElement;

    // Create FrameRenderer with mocks
    frameRenderer = new FrameRenderer(
      mockTimeManager,
      mockKeyboardManager,
      mockMouseManager,
      mockShaderPipeline,
      mockBufferManager,
      mockPassRenderer,
      mockResourceManager,
      mockCanvas,
      mockFPSCalculator,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with correct default state", () => {
      expect(frameRenderer.isRunning()).toBe(false);
      expect(frameRenderer.getCurrentFPS()).toBe(60);
    });
  });

  describe("running state", () => {
    it("should track running state correctly", () => {
      expect(frameRenderer.isRunning()).toBe(false);

      frameRenderer.setRunning(true);
      expect(frameRenderer.isRunning()).toBe(true);

      frameRenderer.setRunning(false);
      expect(frameRenderer.isRunning()).toBe(false);
    });
  });

  describe("FPS tracking", () => {
    it("should delegate FPS tracking to FPSCalculator", () => {
      expect(frameRenderer.getCurrentFPS()).toBe(60);
      expect(mockFPSCalculator.getFPS).toHaveBeenCalled();
    });

    it("should use getRawFPS for uniforms", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);
      vi.mocked(mockFPSCalculator.getRawFPS).mockReturnValue(144);

      frameRenderer.render(1000);

      expect(mockFPSCalculator.getRawFPS).toHaveBeenCalled();
    });

    it("should skip frames when FPS limit interval has not elapsed", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);
      frameRenderer.render(1010);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(1);
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(1);
    });

    it("should allow every frame when FPS limit is unlimited", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);

      frameRenderer.setFPSLimit(0);
      frameRenderer.render(1010);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(2);
    });

    it("should not drop near-threshold frames at 60 FPS limit", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(60);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);
      frameRenderer.render(1016.4);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(2);
    });

    it("should use ideal interval advancement to prevent FPS drift", () => {
      // On a 144Hz display targeting 30fps, RAF fires every ~6.94ms.
      // Without ideal advancement, frames snap to RAF ticks and drift below target.
      // With ideal advancement, lastRenderedAt advances by 33.33ms each time,
      // so the next frame is measured from the ideal time, not the actual RAF time.
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.03472);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const interval = 1000 / 144; // ~6.944ms

      // Simulate 144Hz RAF ticks
      frameRenderer.render(1000);                    // Frame 1: first frame renders
      frameRenderer.render(1000 + interval * 1);     // ~1006.94 - skip
      frameRenderer.render(1000 + interval * 2);     // ~1013.89 - skip
      frameRenderer.render(1000 + interval * 3);     // ~1020.83 - skip
      frameRenderer.render(1000 + interval * 4);     // ~1027.78 - skip
      frameRenderer.render(1000 + interval * 5);     // ~1034.72 - render (elapsed > 33.33)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);

      // The 3rd render should happen around t=1066.67, not t=1069.44.
      // Because lastRenderedAt advanced to ~1033.33 (ideal), the next frame
      // at t=1062.5 (9th tick) should also pass since elapsed = 62.5-33.33 = 29.17 < 30.
      // But t=1069.44 (10th tick) would have elapsed = 69.44-33.33 = 36.11 >= 30 → render.
      // Key point: with ideal advancement, we don't lose frames to accumulated drift.
      frameRenderer.render(1000 + interval * 6);     // ~1041.67 - skip
      frameRenderer.render(1000 + interval * 7);     // ~1048.61 - skip
      frameRenderer.render(1000 + interval * 8);     // ~1055.56 - skip
      frameRenderer.render(1000 + interval * 9);     // ~1062.50 - skip
      frameRenderer.render(1000 + interval * 10);    // ~1069.44 - render

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(3);

      // Continue — 3 rendered frames in ~69.44ms = ~43.2 FPS effective rate
      // which is correct since 144Hz RAF ticks don't align perfectly with 33.33ms.
      // But over many frames, ideal advancement keeps the average at 30fps.
      frameRenderer.render(1000 + interval * 14);    // ~1097.22 - render (97.22-66.67=30.56 >= 30)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(4);
    });

    it("should snap lastRenderedAt to current time after large gap", () => {
      // Simulates tab being backgrounded then returning
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.033333);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);   // First frame
      frameRenderer.render(5000);   // 4 seconds later (tab was backgrounded)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);

      // After the large gap, lastRenderedAt should snap to current time (5000),
      // not advance by 33.33ms from 1000. So the next frame at 5010 should be skipped.
      frameRenderer.render(5010);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);

      // But a frame at 5034 (34ms later) should render
      frameRenderer.render(5034);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(3);
    });

    it("should render at correct rate over many frames with 30fps limit on 60Hz", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      // Simulate 60Hz display (16.67ms intervals) for 10 frames
      let renderCount = 0;
      for (let i = 0; i < 10; i++) {
        const prevCount = mockTimeManager.updateFrame.mock.calls.length;
        frameRenderer.render(1000 + i * 16.667);
        if (mockTimeManager.updateFrame.mock.calls.length > prevCount) {
          renderCount++;
        }
      }

      // 10 ticks at 60Hz = ~166.7ms. At 30fps we expect ~5 renders (every other tick)
      expect(renderCount).toBe(5);
    });

    it("should render at correct rate over many frames with 60fps limit on 60Hz", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(60);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      // Simulate 60Hz display for 10 frames — every frame should render
      for (let i = 0; i < 10; i++) {
        frameRenderer.render(1000 + i * 16.667);
      }

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(10);
    });

    it("should handle FPS limit change mid-stream", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);    // renders
      frameRenderer.render(1016.67); // skip (30fps)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(1);

      // Switch to 60fps — setFPSLimit resets lastRenderedAt to null
      frameRenderer.setFPSLimit(60);
      frameRenderer.render(1033.33); // renders (first frame after limit change)
      frameRenderer.render(1050);    // renders (16.67ms >= 15ms tolerance)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(3);
    });

    it("should render first frame with FPS limit enabled (lastRenderedAt starts null)", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      // First frame should always render even with FPS limit,
      // because lastRenderedAt is null so the limit check is skipped
      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(1);
      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
    });

    it("should not call FPS tracking for skipped frames", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);  // renders
      frameRenderer.render(1010);  // skipped (10ms < 30ms threshold)
      frameRenderer.render(1020);  // skipped (20ms < 30ms threshold)

      // Only 1 frame should have updated FPS tracking
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(1);
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalledTimes(1);
      expect(mockTimeManager.incrementFrame).toHaveBeenCalledTimes(1);
    });

    it("should handle duplicate frame (deltaTime=0) during FPS-limited rendering", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      // First render normally
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(1);

      // Second render passes FPS limit check but has deltaTime=0 (VS Code duplicate)
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0);
      frameRenderer.render(1040);

      // updateFrame is called (it passes the FPS limit) but the frame is dropped
      // due to deltaTime=0 check. FPS tracking should NOT run.
      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(1); // still 1
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalledTimes(1); // still 1

      // Next normal frame should still work correctly
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      frameRenderer.render(1074);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(3);
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(2);
    });

    it("should achieve target FPS over extended run on 144Hz display", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.006944);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const interval = 1000 / 144; // ~6.944ms
      let renderCount = 0;

      // Simulate 2 seconds of 144Hz frames (288 ticks)
      for (let i = 0; i < 288; i++) {
        const prevCount = mockTimeManager.updateFrame.mock.calls.length;
        frameRenderer.render(1000 + i * interval);
        if (mockTimeManager.updateFrame.mock.calls.length > prevCount) {
          renderCount++;
        }
      }

      // 2 seconds at 30fps target = 60 renders.
      // Allow ±1 for boundary effects on first/last frame.
      expect(renderCount).toBeGreaterThanOrEqual(59);
      expect(renderCount).toBeLessThanOrEqual(61);
    });

    it("should achieve target FPS over extended run on 60Hz display at 30fps limit", () => {
      frameRenderer.setRunning(true);
      frameRenderer.setFPSLimit(30);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      let renderCount = 0;

      // Simulate 2 seconds of 60Hz frames (120 ticks)
      for (let i = 0; i < 120; i++) {
        const prevCount = mockTimeManager.updateFrame.mock.calls.length;
        frameRenderer.render(1000 + i * 16.667);
        if (mockTimeManager.updateFrame.mock.calls.length > prevCount) {
          renderCount++;
        }
      }

      // 2 seconds at 30fps = 60 renders (every other 60Hz tick)
      expect(renderCount).toBe(60);
    });

    it("should render every frame when unlimited (fpsLimit=0)", () => {
      frameRenderer.setRunning(true);
      // No FPS limit set (default is 0)
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      // Rapid frames at 1ms apart should all render
      frameRenderer.render(1000);
      frameRenderer.render(1001);
      frameRenderer.render(1002);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(3);
    });

    it("should handle switching from unlimited to limited FPS", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      // Unlimited mode — all frames render
      frameRenderer.render(1000);
      frameRenderer.render(1001);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(2);

      // Switch to 30fps limit — resets lastRenderedAt
      frameRenderer.setFPSLimit(30);
      frameRenderer.render(1010);  // renders (first frame after limit, lastRenderedAt was null)
      frameRenderer.render(1020);  // skip (10ms < 30ms)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(3);

      frameRenderer.render(1044);  // renders (34ms >= 30ms)

      expect(mockTimeManager.updateFrame).toHaveBeenCalledTimes(4);
    });
  });

  describe("render loop", () => {
    it("should not start render loop if already running", () => {
      frameRenderer.setRunning(true);
      const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

      frameRenderer.startRenderLoop();

      expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
      requestAnimationFrameSpy.mockRestore();
    });

    it("should start render loop when not running", () => {
      const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

      frameRenderer.startRenderLoop();

      expect(frameRenderer.isRunning()).toBe(true);
      expect(requestAnimationFrameSpy).toHaveBeenCalled();
      requestAnimationFrameSpy.mockRestore();
    });

    it("should stop render loop", () => {
      frameRenderer.setRunning(true);
      frameRenderer.stopRenderLoop();

      expect(frameRenderer.isRunning()).toBe(false);
    });
  });

  describe("Frame Rendering", () => {
    it("should render normally", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667); // ~60fps
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledWith(1000);
      expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
    });

    it("should not render when not running", () => {
      frameRenderer.setRunning(false);
      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).not.toHaveBeenCalled();
    });

    it("should handle first frame correctly", () => {
      frameRenderer.setRunning(true);
      mockTimeManager.getFrame.mockReturnValue(0);

      frameRenderer.render(1000);

      expect(mockFPSCalculator.reset).toHaveBeenCalled();
      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
      expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled(); // First frame doesn't update FPS
      expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
    });

    it("should update FPS calculator for subsequent frames", () => {
      frameRenderer.setRunning(true);
      mockTimeManager.getFrame.mockReturnValue(5);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);

      frameRenderer.render(1000);

      expect(mockFPSCalculator.updateFrame).toHaveBeenCalledWith(1000);
      expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
    });

    it("should not update frame when paused", () => {
      frameRenderer.setRunning(true);
      mockTimeManager.getFrame.mockReturnValue(5);
      mockTimeManager.isPaused.mockReturnValue(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);

      const mockPasses = [
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ];
      const mockPassShaders = {
        'Buffer A': { mProgram: {}, mResult: true },
        'Image': { mProgram: {}, mResult: true }
      };
      const mockPassBuffers = {
        'Buffer A': {
          front: { mTex0: {} },
          back: { mTex0: {} }
        }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);
      mockBufferManager.getPassBuffers.mockReturnValue(mockPassBuffers);

      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
      expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
      expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();

      // When paused, only Image pass renders (to handle resize)
      expect(mockPassRenderer.renderPass).toHaveBeenCalledTimes(1);
      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        { name: 'Image', shaderSrc: 'image shader', inputs: {} },
        null,
        { mProgram: {}, mResult: true },
        expect.any(Object)
      );
    });

    it("should handle shader rendering pipeline correctly", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockPasses = [
        { name: "BufferA", shaderSrc: "bufferA source", inputs: {} },
        { name: "Image", shaderSrc: "image source", inputs: {} },
      ];
      const mockPassShaders = {
        "BufferA": { id: 1 }, // Mock PiShader
        "Image": { id: 2 }, // Mock PiShader
      };
      const mockPassBuffers = {
        "BufferA": {
          front: { id: 1 }, // Mock PiRenderTarget
          back: { id: 2 }, // Mock PiRenderTarget
        },
      };

      vi.mocked(mockShaderPipeline.getPasses).mockReturnValue(mockPasses);
      vi.mocked(mockShaderPipeline.getPassShaders).mockReturnValue(
        mockPassShaders,
      );
      vi.mocked(mockBufferManager.getPassBuffers).mockReturnValue(
        mockPassBuffers,
      );

      frameRenderer.render(1000);

      expect(mockPassRenderer.renderPass).toHaveBeenCalledTimes(2); // BufferA + Image
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
      expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
    });

    it("should render all non-Image passes", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockPasses = [
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ];
      const mockPassShaders = {
        'Buffer A': { mProgram: {}, mResult: true },
        'Image': { mProgram: {}, mResult: true }
      };
      const mockPassBuffers = {
        'Buffer A': {
          front: { mTex0: {} },
          back: { mTex0: {} }
        }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);
      mockBufferManager.getPassBuffers.mockReturnValue(mockPassBuffers);

      frameRenderer.render(1000);

      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
        { mTex0: {} },
        { mProgram: {}, mResult: true },
        expect.any(Object)
      );
    });

    it("should render Image pass last with null target", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ];
      const mockPassShaders = {
        'Image': { mProgram: {}, mResult: true }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        { name: 'Image', shaderSrc: 'image shader', inputs: {} },
        null,
        { mProgram: {}, mResult: true },
        expect.any(Object)
      );
    });

    it("should clear keyboard pressed state", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);

      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
    });

    it("should generate correct uniforms", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(16.67);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);
      vi.mocked(mockTimeManager.getCurrentTime).mockReturnValue(1000);
      vi.mocked(mockTimeManager.getCurrentDate).mockReturnValue(new Float32Array([2025, 1, 1, 0]));
      vi.mocked(mockFPSCalculator.getRawFPS).mockReturnValue(59.8);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ];
      const mockPassShaders = {
        'Image': { mProgram: {}, mResult: true }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          res: new Float32Array([800, 600, 800 / 600]),
          time: 1000,
          timeDelta: 16.67,
          frameRate: 59.8,
          frame: 1,
          date: new Float32Array([2025, 1, 1, 0]),
          mouse: new Float32Array([0, 0, 0, 0])
        })
      );
    });

    it("should skip rendering common pass", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockPasses = [
        { name: "BufferA", shaderSrc: "buffer shader", inputs: {} },
        { name: "common", shaderSrc: "common shader", inputs: {} },
        { name: "Image", shaderSrc: "image shader", inputs: {} }
      ];
      const mockPassShaders = {
        "BufferA": { mProgram: {}, mResult: true },
        "common": { mProgram: {}, mResult: true },
        "Image": { mProgram: {}, mResult: true }
      };
      const mockPassBuffers = {
        "BufferA": {
          front: { mTex0: {} },
          back: { mTex0: {} }
        }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);
      mockBufferManager.getPassBuffers.mockReturnValue(mockPassBuffers);

      frameRenderer.render(1000);

      // Should render BufferA and Image, but skip common
      expect(mockPassRenderer.renderPass).toHaveBeenCalledTimes(2);
      // Verify that renderPass was called for BufferA and Image, but not common
      const renderPassCalls = vi.mocked(mockPassRenderer.renderPass).mock.calls;
      const renderedPassNames = renderPassCalls.map(call => call[0].name);
      expect(renderedPassNames).toContain("BufferA");
      expect(renderedPassNames).toContain("Image");
      expect(renderedPassNames).not.toContain("common");
    });
  });

  describe("VS Code Webview Multi-Panel Fix", () => {
    // Solves issue where if rendering in multiple vscode panels, requestAnimationFrame will trigger
    // an update in all panels causing over rendering.
    // Unsure why this happens...

    it("should drop frames when delta time === 0 (VS Code duplicate frames)", () => {
      // This fixes the VS Code issue where multiple webview panels cause requestAnimationFrame
      // to trigger duplicate calls with identical timestamps
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0); // Duplicate frame
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(5); // Not first frame

      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
      // Should return early, so these shouldn't be called
      expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
      expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).not.toHaveBeenCalled();
      expect(mockPassRenderer.renderPass).not.toHaveBeenCalled();
    });

    it("should NOT drop frame 0 even with delta time === 0 (new shader load)", () => {
      // First frame should render even with 0 delta (new shader loaded while paused)
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(0); // First frame
      vi.mocked(mockTimeManager.isPaused).mockReturnValue(false);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ];
      const mockPassShaders = {
        'Image': { mProgram: {}, mResult: true }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      // Should NOT return early - first frame should render
      expect(mockFPSCalculator.reset).toHaveBeenCalled();
      expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
      expect(mockPassRenderer.renderPass).toHaveBeenCalled();
    });

    it("should handle sequence of duplicate and normal frames correctly", () => {
      // This tests the real-world scenario in VS Code where multiple panels cause
      // mixed sequences of normal frames and duplicate frames with 0ms delta
      frameRenderer.setRunning(true);

      const frameSequence = [
        { time: 1000, delta: 0.016667 }, // Normal frame
        { time: 1016.67, delta: 0 }, // Duplicate (VS Code bug)
        { time: 1033.34, delta: 0.016667 }, // Normal frame
        { time: 1033.34, delta: 0 }, // Another duplicate
        { time: 1050, delta: 0.016666 }, // Normal frame
      ];

      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameSequence.forEach((frame, index) => {
        // Setup delta time for this frame
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(frame.delta);

        frameRenderer.render(frame.time);

        // Count how many non-duplicate frames we've processed so far
        const nonDuplicateFramesProcessed = frameSequence
          .slice(0, index + 1)
          .filter((f) => f.delta > 0).length;

        // Assert based on whether it's a duplicate
        if (frame.delta === 0) {
          // Duplicate frames should not process beyond updateFrame
          expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(
            nonDuplicateFramesProcessed,
          );
        } else {
          // Normal frames should process completely
          expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(frame.time);
          expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(
            nonDuplicateFramesProcessed,
          );
        }
      });

      // Should only increment frame for non-duplicate frames (3 times)
      expect(mockTimeManager.incrementFrame).toHaveBeenCalledTimes(3);
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalledTimes(3);
    });

    it("should preserve exact zero delta detection with == operator", () => {
      // Testing that == 0 catches exactly 0 (VS Code duplicates) but allows any non-zero delta
      // This ensures high refresh rate monitors (1000Hz+) still work properly
      frameRenderer.setRunning(true);

      const testCases = [
        { delta: 0, shouldDrop: true }, // Exact zero (VS Code duplicate)
        { delta: 0.0, shouldDrop: true }, // Explicit zero (VS Code duplicate)
        { delta: -0, shouldDrop: true }, // Negative zero (VS Code duplicate)
        { delta: 0.0001, shouldDrop: false }, // Very small but non-zero (10000Hz monitor)
        { delta: Number.EPSILON, shouldDrop: false }, // Smallest positive number
      ];

      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      testCases.forEach(({ delta, shouldDrop }, index) => {
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(delta);

        frameRenderer.render(1000 + index);

        if (shouldDrop) {
          expect(mockFPSCalculator.updateFrame).toHaveBeenCalledTimes(0);
        } else {
          expect(mockFPSCalculator.updateFrame).toHaveBeenCalledWith(
            1000 + index,
          );
        }

        // Reset for next test
        vi.clearAllMocks();
        vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);
      });
    });

    it("should not render shader pipeline for duplicate frames", () => {
      // This ensures that VS Code duplicate frames don't waste GPU resources on redundant rendering
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0); // Duplicate frame

      const mockPasses = [
        { name: "BufferA", shaderSrc: "bufferA source", inputs: {} },
        { name: "Image", shaderSrc: "image source", inputs: {} },
      ];
      vi.mocked(mockShaderPipeline.getPasses).mockReturnValue(mockPasses);

      frameRenderer.render(1000);

      expect(mockPassRenderer.renderPass).not.toHaveBeenCalled();
      expect(mockShaderPipeline.getPasses).not.toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).not.toHaveBeenCalled();
    });
  });

  describe("renderSinglePass", () => {
    it("should render a single pass with null target", () => {
      const testPass = { name: 'Test', shaderSrc: 'test shader', inputs: {} };
      mockShaderPipeline.getPassShader.mockReturnValue({ mProgram: {}, mResult: true });

      frameRenderer.renderSinglePass(testPass);

      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        testPass,
        null,
        { mProgram: {}, mResult: true },
        expect.any(Object)
      );
    });

    it("should handle null shader gracefully", () => {
      mockShaderPipeline.getPassShader.mockReturnValue(null);
      const testPass = { name: 'Test', shaderSrc: 'test shader', inputs: {} };

      frameRenderer.renderSinglePass(testPass);

      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        testPass,
        null,
        null,
        expect.any(Object)
      );
    });
  });

  describe("buffer swapping", () => {
    it("should swap front and back buffers for non-Image passes", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const bufferA = {
        front: 'front_texture',
        back: 'back_texture'
      };

      const originalFront = bufferA.front;
      const originalBack = bufferA.back;

      mockBufferManager.getPassBuffers.mockReturnValue({
        'Buffer A': bufferA
      });

      mockShaderPipeline.getPasses.mockReturnValue([
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} }
      ]);

      mockShaderPipeline.getPassShaders.mockReturnValue({
        'Buffer A': { mProgram: {}, mResult: true }
      });

      frameRenderer.render(1000);

      expect(bufferA.front).toBe(originalBack);
      expect(bufferA.back).toBe(originalFront);
    });
  });

  describe("setSampleRate", () => {
    it("should update the sample rate used in uniforms", () => {
      frameRenderer.setSampleRate(48000);
      mockResourceManager.getAudioSampleRate.mockReturnValue(0);

      const uniforms = frameRenderer.getUniforms();

      expect(uniforms.sampleRate).toBe(48000);
    });

    it("should prefer resourceManager audio sample rate over setSampleRate value", () => {
      frameRenderer.setSampleRate(48000);
      mockResourceManager.getAudioSampleRate.mockReturnValue(96000);

      const uniforms = frameRenderer.getUniforms();

      expect(uniforms.sampleRate).toBe(96000);
    });

    it("should use default sampleRate (44100) when resourceManager returns 0 and setSampleRate is not called", () => {
      mockResourceManager.getAudioSampleRate.mockReturnValue(0);

      const uniforms = frameRenderer.getUniforms();

      expect(uniforms.sampleRate).toBe(44100);
    });
  });

  describe("getUniforms - new fields", () => {
    it("should include channelTime initialized to [0, 0, 0, 0]", () => {
      const uniforms = frameRenderer.getUniforms();

      expect(uniforms.channelTime).toEqual([0, 0, 0, 0]);
    });

    it("should include sampleRate from resourceManager", () => {
      mockResourceManager.getAudioSampleRate.mockReturnValue(22050);

      const uniforms = frameRenderer.getUniforms();

      expect(uniforms.sampleRate).toBe(22050);
    });

    it("should include channelLoaded initialized to [0, 0, 0, 0]", () => {
      const uniforms = frameRenderer.getUniforms();

      expect(uniforms.channelLoaded).toEqual([0, 0, 0, 0]);
    });
  });

  describe("getPassUniforms", () => {
    it("should set channelTime and channelLoaded for video inputs", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockVideoElement = { currentTime: 5.25 };
      mockResourceManager.getVideoElement.mockReturnValue(mockVideoElement);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'image shader', inputs: {
          iChannel0: { type: 'video', path: 'video.mp4' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      expect(mockResourceManager.getVideoElement).toHaveBeenCalledWith('video.mp4');
      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelTime[0]).toBe(5.25);
      expect(passUniforms.channelLoaded[0]).toBe(1);
    });

    it("should use resolved_path for video element lookup when available", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockVideoElement = { currentTime: 2.0 };
      mockResourceManager.getVideoElement.mockReturnValue(mockVideoElement);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'video', path: 'video.mp4', resolved_path: '/resolved/video.mp4' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      expect(mockResourceManager.getVideoElement).toHaveBeenCalledWith('/resolved/video.mp4');
    });

    it("should set channelTime and channelLoaded for audio inputs", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockAudioState = { currentTime: 12.5 };
      mockResourceManager.getAudioState.mockReturnValue(mockAudioState);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'image shader', inputs: {
          iChannel1: { type: 'audio', path: 'music.mp3' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      expect(mockResourceManager.getAudioState).toHaveBeenCalledWith('music.mp3');
      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelTime[1]).toBe(12.5);
      expect(passUniforms.channelLoaded[1]).toBe(1);
    });

    it("should use resolved_path for audio state lookup when available", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockAudioState = { currentTime: 3.0 };
      mockResourceManager.getAudioState.mockReturnValue(mockAudioState);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'audio', path: 'audio.mp3', resolved_path: '/resolved/audio.mp3' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      expect(mockResourceManager.getAudioState).toHaveBeenCalledWith('/resolved/audio.mp3');
    });

    it("should set channelLoaded for texture inputs", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockResourceManager.getImageTextureCache.mockReturnValue({
        'image.png': { mXres: 256, mYres: 256 },
      });

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'texture', path: 'image.png' },
          iChannel1: { type: 'texture', path: 'missing.png' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelLoaded[0]).toBe(1);
      expect(passUniforms.channelLoaded[1]).toBe(0);
      expect(passUniforms.channelTime[0]).toBe(0);
      expect(passUniforms.channelTime[1]).toBe(0);
    });

    it("should set channelLoaded for buffer inputs", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockBufferManager.getPassBuffers.mockReturnValue({
        'Buffer A': { front: { mTex0: {} }, back: { mTex0: {} } },
      });

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'buffer', source: 'Buffer A' },
          iChannel1: { type: 'buffer', source: 'Buffer B' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelLoaded[0]).toBe(1);
      expect(passUniforms.channelLoaded[1]).toBe(0);
    });

    it("should set channelLoaded for keyboard inputs", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockResourceManager.getKeyboardTexture.mockReturnValue({ mXres: 256, mYres: 3 });

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel2: { type: 'keyboard' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelLoaded[2]).toBe(1);
    });

    it("should not set channelLoaded for keyboard input when texture is null", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockResourceManager.getKeyboardTexture.mockReturnValue(null);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'keyboard' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelLoaded[0]).toBe(0);
    });

    it("should leave channelTime at 0 when video element is not found", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockResourceManager.getVideoElement.mockReturnValue(undefined);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'video', path: 'missing.mp4' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelTime[0]).toBe(0);
      expect(passUniforms.channelLoaded[0]).toBe(0);
    });

    it("should leave channelTime at 0 when audio state is not found", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockResourceManager.getAudioState.mockReturnValue(null);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel0: { type: 'audio', path: 'missing.mp3' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelTime[0]).toBe(0);
      expect(passUniforms.channelLoaded[0]).toBe(0);
    });

    it("should skip channels with no input configured", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const mockPasses = [
        { name: 'Image', shaderSrc: 'shader', inputs: {
          iChannel2: { type: 'video', path: 'video.mp4' },
        }}
      ];
      const mockPassShaders = { 'Image': { mProgram: {}, mResult: true } };
      const mockVideoElement = { currentTime: 7.0 };
      mockResourceManager.getVideoElement.mockReturnValue(mockVideoElement);

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);

      frameRenderer.render(1000);

      const passUniforms = mockPassRenderer.renderPass.mock.calls[0][3];
      expect(passUniforms.channelTime[0]).toBe(0);
      expect(passUniforms.channelTime[1]).toBe(0);
      expect(passUniforms.channelTime[2]).toBe(7.0);
      expect(passUniforms.channelTime[3]).toBe(0);
      expect(passUniforms.channelLoaded[2]).toBe(1);
    });
  });

  describe("updateAudioTextures", () => {
    it("should call resourceManager.updateAudioTextures during render", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      frameRenderer.render(1000);

      expect(mockResourceManager.updateAudioTextures).toHaveBeenCalledTimes(1);
    });

    it("should call updateAudioTextures before getUniforms each frame", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      const callOrder: string[] = [];
      mockResourceManager.updateAudioTextures.mockImplementation(() => {
        callOrder.push('updateAudioTextures');
      });
      mockResourceManager.getAudioSampleRate.mockImplementation(() => {
        callOrder.push('getAudioSampleRate');
        return 44100;
      });

      frameRenderer.render(1000);

      const audioUpdateIndex = callOrder.indexOf('updateAudioTextures');
      const sampleRateIndex = callOrder.indexOf('getAudioSampleRate');
      expect(audioUpdateIndex).toBeLessThan(sampleRateIndex);
    });
  });

  describe("edge cases", () => {
    it("should handle missing Image pass", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockShaderPipeline.getPasses.mockReturnValue([
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} }
      ]);

      mockShaderPipeline.getPassShaders.mockReturnValue({
        'Buffer A': { mProgram: {}, mResult: true }
      });

      // Provide buffer for Buffer A to prevent the error
      mockBufferManager.getPassBuffers.mockReturnValue({
        'Buffer A': {
          front: { mTex0: {} },
          back: { mTex0: {} }
        }
      });

      expect(() => frameRenderer.render(1000)).not.toThrow();
    });

    it("should clear canvas when Image pass has no shader", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockShaderPipeline.getPasses.mockReturnValue([
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ]);
      mockShaderPipeline.getPassShaders.mockReturnValue({});

      frameRenderer.render(1000);

      expect(mockPassRenderer.clearCanvas).toHaveBeenCalledTimes(1);
      expect(mockPassRenderer.renderPass).not.toHaveBeenCalled();
    });

    it("should clear canvas when no Image pass exists", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockShaderPipeline.getPasses.mockReturnValue([]);

      frameRenderer.render(1000);

      expect(mockPassRenderer.clearCanvas).toHaveBeenCalledTimes(1);
    });

    it("should not clear canvas when Image pass has a valid shader", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockShaderPipeline.getPasses.mockReturnValue([
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ]);
      mockShaderPipeline.getPassShaders.mockReturnValue({
        'Image': { mProgram: {}, mResult: true }
      });

      frameRenderer.render(1000);

      expect(mockPassRenderer.clearCanvas).not.toHaveBeenCalled();
      expect(mockPassRenderer.renderPass).toHaveBeenCalled();
    });

    it("should handle empty passes array", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockShaderPipeline.getPasses.mockReturnValue([]);

      expect(() => frameRenderer.render(1000)).not.toThrow();
    });

    it("should handle missing pass buffers", () => {
      frameRenderer.setRunning(true);
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
      vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

      mockBufferManager.getPassBuffers.mockReturnValue({});

      expect(() => frameRenderer.render(1000)).not.toThrow();
    });

    it("should render first frame even when paused (new shader loaded)", () => {
      frameRenderer.setRunning(true);
      mockTimeManager.getFrame.mockReturnValue(0); // First frame
      mockTimeManager.isPaused.mockReturnValue(true); // Paused
      vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);

      const mockPasses = [
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
        { name: 'Image', shaderSrc: 'image shader', inputs: {} }
      ];
      const mockPassShaders = {
        'Buffer A': { mProgram: {}, mResult: true },
        'Image': { mProgram: {}, mResult: true }
      };
      const mockPassBuffers = {
        'Buffer A': {
          front: { mTex0: {} },
          back: { mTex0: {} }
        }
      };

      mockShaderPipeline.getPasses.mockReturnValue(mockPasses);
      mockShaderPipeline.getPassShaders.mockReturnValue(mockPassShaders);
      mockBufferManager.getPassBuffers.mockReturnValue(mockPassBuffers);

      frameRenderer.render(1000);

      // Both buffer pass and image pass should render on first frame even when paused
      expect(mockPassRenderer.renderPass).toHaveBeenCalledTimes(2);
      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        { name: 'Buffer A', shaderSrc: 'buffer shader', inputs: {} },
        { mTex0: {} },
        { mProgram: {}, mResult: true },
        expect.any(Object)
      );
      expect(mockPassRenderer.renderPass).toHaveBeenCalledWith(
        { name: 'Image', shaderSrc: 'image shader', inputs: {} },
        null,
        { mProgram: {}, mResult: true },
        expect.any(Object)
      );

      // Frame should not increment when paused
      expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
    });
  });
});

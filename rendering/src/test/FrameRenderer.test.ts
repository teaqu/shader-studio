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

      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
      expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
      expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
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

      frameRenderer.render(1000);

      expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
      // Should return early, so these shouldn't be called
      expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
      expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
      expect(mockKeyboardManager.clearPressed).not.toHaveBeenCalled();
      expect(mockPassRenderer.renderPass).not.toHaveBeenCalled();
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
  });
});

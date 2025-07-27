import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameRenderer } from "../lib/rendering/FrameRenderer";
import { TimeManager } from "../lib/util/TimeManager";
import { KeyboardManager } from "../lib/input/KeyboardManager";
import { MouseManager } from "../lib/input/MouseManager";
import { ShaderPipeline } from "../lib/rendering/ShaderPipeline";
import { BufferManager } from "../lib/rendering/BufferManager";
import { PassRenderer } from "../lib/rendering/PassRenderer";
import { FPSCalculator } from "../lib/util/FPSCalculator";

// Mock dependencies
vi.mock("../lib/util/TimeManager");
vi.mock("../lib/input/KeyboardManager");
vi.mock("../lib/input/MouseManager");
vi.mock("../lib/rendering/ShaderPipeline");
vi.mock("../lib/rendering/BufferManager");
vi.mock("../lib/rendering/PassRenderer");
vi.mock("../lib/util/FPSCalculator");

describe("FrameRenderer", () => {
  let frameRenderer: FrameRenderer;
  let mockTimeManager: TimeManager;
  let mockKeyboardManager: KeyboardManager;
  let mockMouseManager: MouseManager;
  let mockShaderPipeline: ShaderPipeline;
  let mockBufferManager: BufferManager;
  let mockPassRenderer: PassRenderer;
  let mockCanvas: HTMLCanvasElement;
  let mockFPSCalculator: FPSCalculator;

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
    } as any;

    mockKeyboardManager = {
      clearPressed: vi.fn(),
    } as any;

    mockMouseManager = {
      getMouse: vi.fn(() => new Float32Array([0, 0, 0, 0])),
    } as any;

    mockShaderPipeline = {
      getPasses: vi.fn(() => []),
      getPassShaders: vi.fn(() => ({})),
      getPassShader: vi.fn(() => null),
    } as any;

    mockBufferManager = {
      getPassBuffers: vi.fn(() => ({})),
    } as any;

    mockPassRenderer = {
      renderPass: vi.fn(),
    } as any;

    mockFPSCalculator = {
      reset: vi.fn(),
      updateFrame: vi.fn(),
      getFPS: vi.fn(() => 60),
      getRawFPS: vi.fn(() => 60),
    } as any;

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

    describe("Edge Cases", () => {
      it("should not process frames when not running", () => {
        frameRenderer.setRunning(false);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);

        frameRenderer.render(1000);

        expect(mockTimeManager.updateFrame).not.toHaveBeenCalled();
        expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
        expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
        expect(mockKeyboardManager.clearPressed).not.toHaveBeenCalled();
      });

      it("should handle first frame correctly (frame === 0)", () => {
        frameRenderer.setRunning(true);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
        vi.mocked(mockTimeManager.getFrame).mockReturnValue(0);

        frameRenderer.render(1000);

        expect(mockFPSCalculator.reset).toHaveBeenCalled();
        expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled(); // First frame doesn't update FPS
        expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
        expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
      });

      it("should not update FPS when paused", () => {
        frameRenderer.setRunning(true);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
        vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);
        vi.mocked(mockTimeManager.isPaused).mockReturnValue(true);

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
          "BufferA": { id: 1 } as any, // Mock PiShader
          "Image": { id: 2 } as any, // Mock PiShader
        };
        const mockPassBuffers = {
          "BufferA": {
            front: { id: 1 } as any, // Mock PiRenderTarget
            back: { id: 2 } as any, // Mock PiRenderTarget
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
    });

    describe("FPS and Frame Counting", () => {
      it("should return correct FPS from FPSCalculator", () => {
        vi.mocked(mockFPSCalculator.getFPS).mockReturnValue(120);

        const fps = frameRenderer.getCurrentFPS();

        expect(fps).toBe(120);
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

    describe("Edge Cases", () => {
      it("should not process frames when not running", () => {
        frameRenderer.setRunning(false);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);

        frameRenderer.render(1000);

        expect(mockTimeManager.updateFrame).not.toHaveBeenCalled();
        expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
        expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
        expect(mockKeyboardManager.clearPressed).not.toHaveBeenCalled();
      });

      it("should handle first frame correctly (frame === 0)", () => {
        frameRenderer.setRunning(true);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
        vi.mocked(mockTimeManager.getFrame).mockReturnValue(0);

        frameRenderer.render(1000);

        expect(mockFPSCalculator.reset).toHaveBeenCalled();
        expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled(); // First frame doesn't update FPS
        expect(mockTimeManager.incrementFrame).toHaveBeenCalled();
        expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
      });

      it("should not update FPS when paused", () => {
        frameRenderer.setRunning(true);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
        vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);
        vi.mocked(mockTimeManager.isPaused).mockReturnValue(true);

        frameRenderer.render(1000);

        expect(mockTimeManager.updateFrame).toHaveBeenCalledWith(1000);
        expect(mockFPSCalculator.updateFrame).not.toHaveBeenCalled();
        expect(mockTimeManager.incrementFrame).not.toHaveBeenCalled();
        expect(mockKeyboardManager.clearPressed).toHaveBeenCalled();
      });

      it("should handle shader rendering pipeline correctly for non-duplicate frames", () => {
        frameRenderer.setRunning(true);
        vi.mocked(mockTimeManager.getDeltaTime).mockReturnValue(0.016667);
        vi.mocked(mockTimeManager.getFrame).mockReturnValue(1);

        const mockPasses = [
          { name: "BufferA", shaderSrc: "bufferA source", inputs: {} },
          { name: "Image", shaderSrc: "image source", inputs: {} },
        ];
        const mockPassShaders = {
          "BufferA": { id: 1 } as any, // Mock PiShader
          "Image": { id: 2 } as any, // Mock PiShader
        };
        const mockPassBuffers = {
          "BufferA": {
            front: { id: 1 } as any, // Mock PiRenderTarget
            back: { id: 2 } as any, // Mock PiRenderTarget
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
    });
  });
  describe("Render Loop Control", () => {
    it("should start render loop when not already running", () => {
      expect(frameRenderer.isRunning()).toBe(false);

      // Mock requestAnimationFrame
      const mockRAF = vi.fn();
      global.requestAnimationFrame = mockRAF;

      frameRenderer.startRenderLoop();

      expect(frameRenderer.isRunning()).toBe(true);
      expect(mockRAF).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should not start render loop when already running", () => {
      frameRenderer.setRunning(true);
      const mockRAF = vi.fn();
      global.requestAnimationFrame = mockRAF;

      frameRenderer.startRenderLoop();

      expect(mockRAF).not.toHaveBeenCalled();
    });

    it("should stop render loop", () => {
      frameRenderer.setRunning(true);
      expect(frameRenderer.isRunning()).toBe(true);

      frameRenderer.stopRenderLoop();

      expect(frameRenderer.isRunning()).toBe(false);
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
});

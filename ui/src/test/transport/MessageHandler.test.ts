import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageHandler } from "../../lib/transport/MessageHandler";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { Transport } from "../../lib/transport/MessageTransport";
import type { ShaderLocker } from "../../lib/ShaderLocker";
import type { ShaderSourceMessage } from "@shader-studio/types";

const createMockRenderingEngine = () => ({
  compileShaderPipeline: vi.fn(),
  cleanup: vi.fn(),
  isLockedShader: vi.fn().mockReturnValue(false),
  togglePause: vi.fn(),
  toggleLock: vi.fn(),
  startRenderLoop: vi.fn(),
  stopRenderLoop: vi.fn(),
  getCurrentFPS: vi.fn().mockReturnValue(60),
  getLockedShaderPath: vi.fn(),
  dispose: vi.fn(),
});

const createMockTransport = () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: vi.fn().mockReturnValue("websocket"),
  isConnected: vi.fn().mockReturnValue(true),
});

const createMockShaderLocker = () => ({
  isLocked: vi.fn(),
  getLockedShaderPath: vi.fn(),
});

describe("MessageHandler", () => {
  let messageHandler: MessageHandler;
  let mockRenderingEngine: ReturnType<typeof createMockRenderingEngine>;
  let mockTransport: ReturnType<typeof createMockTransport>;
  let mockShaderLocker: ReturnType<typeof createMockShaderLocker>;

  beforeEach(() => {
    mockRenderingEngine = createMockRenderingEngine();
    mockTransport = createMockTransport();
    mockShaderLocker = createMockShaderLocker();

    // Default: not locked
    mockShaderLocker.isLocked.mockReturnValue(false);

    messageHandler = new MessageHandler(
      mockTransport as unknown as Transport,
      mockRenderingEngine as unknown as RenderingEngine,
      mockShaderLocker as unknown as ShaderLocker
    );

    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
  });

  describe("when handleShaderMessage is called", () => {
    it("should set lastEvent even if compilation fails", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      mockRenderingEngine.compileShaderPipeline.mockResolvedValue({
        success: false,
        error: "Compile error",
      });

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(messageHandler.getLastEvent()).toBe(shaderEvent);
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: "error",
        payload: ["Compile error"],
      });
      expect(mockRenderingEngine.startRenderLoop).not.toHaveBeenCalled();
    });
  });


  describe("when reset is called", () => {
    it("should call cleanup", () => {
      messageHandler.reset();
      expect(mockRenderingEngine.cleanup).toHaveBeenCalledTimes(1);
    });

    it("should call onReset callback when lastEvent exists", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      mockRenderingEngine.compileShaderPipeline.mockResolvedValue({
        success: true,
      });

      await messageHandler.handleShaderMessage(shaderEvent);

      const onResetCallback = vi.fn();
      messageHandler.reset(onResetCallback);

      expect(mockRenderingEngine.cleanup).toHaveBeenCalled();
      expect(onResetCallback).toHaveBeenCalledTimes(1);
    });

    it("should send error message when no lastEvent exists", () => {
      messageHandler.reset();
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: "error",
        payload: ["❌ No shader to reset"],
      });
    });
  });

  describe("locking functionality", () => {
    it("should process shader if not locked", async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockRenderingEngine.compileShaderPipeline.mockResolvedValue({ success: true });
      const event = {
        data: {
          type: "shaderSource",
          code: "void main() {}",
          config: null,
          path: "shaderB.glsl",
          buffers: {},
        },
      };
      await messageHandler.handleShaderMessage(event as any);
      expect(mockRenderingEngine.compileShaderPipeline).toHaveBeenCalledWith(
        "void main() {}",
        null,
        "shaderB.glsl",
        {}
      );
      expect(mockRenderingEngine.startRenderLoop).toHaveBeenCalled();
    });

    it("should skip processing when locked and message is for different shader", async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue("locked-shader.glsl");
      
      const event = {
        data: {
          type: "shaderSource",
          code: "void main() {}",
          config: null,
          path: "different-shader.glsl",
          buffers: {},
        },
      };

      const result = await messageHandler.handleShaderMessage(event as any);
      
      expect(result).toEqual({ running: true });
      expect(mockRenderingEngine.compileShaderPipeline).not.toHaveBeenCalled();
      expect(mockRenderingEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it("should allow processing when locked and message is for the same locked shader", async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue("locked-shader.glsl");
      mockRenderingEngine.compileShaderPipeline.mockResolvedValue({ success: true });
      
      const event = {
        data: {
          type: "shaderSource",
          code: "void main() {}",
          config: null,
          path: "locked-shader.glsl",
          buffers: {},
        },
      };

      const result = await messageHandler.handleShaderMessage(event as any);
      
      expect(result).toEqual({ running: true });
      expect(mockRenderingEngine.compileShaderPipeline).toHaveBeenCalledWith(
        "void main() {}",
        null,
        "locked-shader.glsl",
        {}
      );
      expect(mockRenderingEngine.startRenderLoop).toHaveBeenCalled();
    });

    it("should skip processing when locked and getLockedShaderPath returns undefined", async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue(undefined);
      
      const event = {
        data: {
          type: "shaderSource",
          code: "void main() {}",
          config: null,
          path: "any-shader.glsl",
          buffers: {},
        },
      };

      const result = await messageHandler.handleShaderMessage(event as any);
      
      expect(result).toEqual({ running: true });
      expect(mockRenderingEngine.compileShaderPipeline).not.toHaveBeenCalled();
      expect(mockRenderingEngine.startRenderLoop).not.toHaveBeenCalled();
    });
  });
});

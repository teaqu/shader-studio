import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageHandler } from "../../lib/transport/MessageHandler";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { Transport } from "../../lib/transport/MessageTransport";
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

describe("MessageHandler", () => {
  let messageHandler: MessageHandler;
  let mockRenderingEngine: ReturnType<typeof createMockRenderingEngine>;
  let mockTransport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    mockRenderingEngine = createMockRenderingEngine();
    mockTransport = createMockTransport();

    messageHandler = new MessageHandler(
      mockRenderingEngine as unknown as RenderingEngine,
      mockTransport as unknown as Transport,
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
});

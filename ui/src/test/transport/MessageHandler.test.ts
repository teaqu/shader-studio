import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageHandler } from "../../lib/transport/MessageHandler";
import type { ShaderPipeline } from "../../lib/rendering/ShaderPipeline";
import type { FrameRenderer } from "../../lib/rendering/FrameRenderer";
import type { Transport } from "../../lib/transport/MessageTransport";
import type { ShaderSourceMessage } from "@shader-studio/types";

const createMockShaderPipeline = () => ({
  compileShaderPipeline: vi.fn(),
  cleanup: vi.fn(),
  getPass: vi.fn(),
  getPasses: vi.fn(),
});

const createMockFrameRenderer = () => ({
  isRunning: vi.fn(),
  startRenderLoop: vi.fn(),
  stopRenderLoop: vi.fn(),
  render: vi.fn(),
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
  let mockShaderPipeline: ReturnType<typeof createMockShaderPipeline>;
  let mockFrameRenderer: ReturnType<typeof createMockFrameRenderer>;
  let mockTransport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    mockShaderPipeline = createMockShaderPipeline();
    mockFrameRenderer = createMockFrameRenderer();
    mockTransport = createMockTransport();

    messageHandler = new MessageHandler(
      mockShaderPipeline as unknown as ShaderPipeline,
      mockFrameRenderer as unknown as FrameRenderer,
      mockTransport as unknown as Transport,
    );

    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
  });


  describe("when reset is called", () => {
    it("should call cleanup", () => {
      messageHandler.reset();

      expect(mockShaderPipeline.cleanup).toHaveBeenCalledTimes(1);
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

      mockShaderPipeline.compileShaderPipeline.mockResolvedValue({
        success: true,
      });
      mockFrameRenderer.isRunning.mockReturnValue(false);

      await messageHandler.handleShaderMessage(shaderEvent);

      const onResetCallback = vi.fn();
      messageHandler.reset(onResetCallback);

      expect(mockShaderPipeline.cleanup).toHaveBeenCalled();
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

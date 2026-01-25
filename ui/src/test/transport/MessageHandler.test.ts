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

      await messageHandler.handleShaderMessage(event as any);
      
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

      await messageHandler.handleShaderMessage(event as any);
      
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
      
      expect(mockRenderingEngine.compileShaderPipeline).not.toHaveBeenCalled();
      expect(mockRenderingEngine.startRenderLoop).not.toHaveBeenCalled();
    });
  });

  describe('Buffer Update Tests', () => {
    let messageHandler: MessageHandler;
    let mockRenderingEngine: any;
    let mockTransport: any;
    let mockShaderLocker: any;

    beforeEach(() => {
      vi.clearAllMocks();
      
      mockRenderingEngine = {
        ...createMockRenderingEngine(),
        updateBufferAndRecompile: vi.fn(),
        getPasses: vi.fn(() => [
          { name: 'BufferA' },
          { name: 'Image' }
        ]),
        getCurrentConfig: vi.fn(() => ({
          passes: {
            BufferA: { path: 'gol-buffer.glsl' }
          }
        }))
      };
      
      mockTransport = createMockTransport();
      mockShaderLocker = {
        ...createMockShaderLocker(),
        isLocked: vi.fn(() => true),
        getLockedShaderPath: vi.fn(() => 'c:\\path\\to\\main.glsl')
      };

      messageHandler = new MessageHandler(
        mockTransport,
        mockRenderingEngine,
        mockShaderLocker
      );
    });

    it('should handle buffer file update when shader is locked and buffer matches', async () => {
      // Mock successful buffer update
      mockRenderingEngine.updateBufferAndRecompile.mockResolvedValue({
        success: true
      });

      // Create message for buffer file update - use the file path from config
      const event: MessageEvent = {
        data: {
          type: 'shaderSource',
          path: 'c:\\path\\to\\gol-buffer.glsl', // Use the file path from config
          code: 'updated buffer A code',
          config: null,
          buffers: {}
        }
      } as any;

      const result = await messageHandler.handleShaderMessage(event);

      // Verify buffer update was called with resolved buffer name
      expect(mockRenderingEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
        'BufferA', // Resolved from file path
        'updated buffer A code'
      );

      // Verify success message was sent to clear errors
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'log',
        payload: ['Buffer \'gol-buffer\' updated and pipeline recompiled']
      });
    });

    it('should ignore buffer file update when buffer does not match', async () => {
      // Create message for non-matching buffer file
      const event: MessageEvent = {
        data: {
          type: 'shaderSource',
          path: 'c:\\path\\to\\NonExistentBuffer.glsl',
          code: 'some code',
          config: null,
          buffers: {}
        }
      } as any;

      const result = await messageHandler.handleShaderMessage(event);

      // Verify buffer update was NOT called
      expect(mockRenderingEngine.updateBufferAndRecompile).not.toHaveBeenCalled();
    });

    it('should resolve buffer name from file path and update correct buffer', async () => {
      // Mock successful buffer update
      mockRenderingEngine.updateBufferAndRecompile.mockResolvedValue({
        success: true
      });

      // Create message for buffer file update - file name doesn't match buffer name
      const event: MessageEvent = {
        data: {
          type: 'shaderSource',
          path: 'c:\\path\\to\\gol-buffer.glsl', // File is gol-buffer.glsl
          code: 'updated buffer content',
          config: null,
          buffers: {}
        }
      } as any;

      const result = await messageHandler.handleShaderMessage(event);

      // Verify buffer update was called with the correct buffer name (BufferA, not gol-buffer)
      expect(mockRenderingEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
        'BufferA', // Should resolve to actual buffer name
        'updated buffer content'
      );

      // Verify success message was sent to clear errors
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'log',
        payload: ['Buffer \'gol-buffer\' updated and pipeline recompiled']
      });
    });

    it('should handle buffer update compilation failure', async () => {
      // Mock failed buffer update
      mockRenderingEngine.updateBufferAndRecompile.mockResolvedValue({
        success: false,
        error: 'Compilation failed'
      });

      const event: MessageEvent = {
        data: {
          type: 'shaderSource',
          path: 'c:\\path\\to\\gol-buffer.glsl', // Use matching file path
          code: 'broken code',
          config: null,
          buffers: {}
        }
      } as any;

      const result = await messageHandler.handleShaderMessage(event);

      // Verify error message was sent
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['Compilation failed']
      });
    });
  });

  describe('Buffer Name Extraction Tests', () => {
    // Test the buffer name extraction logic separately
    function extractBufferNameFromPath(path: string): string | null {
      // Extract filename without extension from path
      const filename = path.split(/[\\/]/).pop(); // Get last part of path
      if (!filename) {
        return null;
      }
      
      // Remove extension
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
      return nameWithoutExt || null; // Return null if empty string after removing extension
    }

    it('should extract buffer name from Windows path', () => {
      const path = 'c:\\Users\\calum\\Projects\\shaders\\shadertoy\\src\\2d\\gol\\gol-buffer.glsl';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBe('gol-buffer');
    });

    it('should extract buffer name from Unix path', () => {
      const path = '/home/user/shaders/buffer.glsl';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBe('buffer');
    });

    it('should handle simple filename', () => {
      const path = 'BufferA.glsl';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBe('BufferA');
    });

    it('should handle multiple dots in filename', () => {
      const path = 'my.complex.buffer.name.glsl';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBe('my.complex.buffer.name');
    });

    it('should return null for empty path', () => {
      const path = '';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBeNull();
    });

    it('should handle path ending with slash', () => {
      const path = 'c:\\path\\to\\';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBeNull();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageHandler } from "../../lib/transport/MessageHandler";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { Transport } from "../../lib/transport/MessageTransport";
import type { ShaderLocker } from "../../lib/ShaderLocker";
import type { ShaderSourceMessage } from "@shader-studio/types";
import { ShaderDebugManager } from "../../lib/ShaderDebugManager";
import { ShaderProcessor } from "../../lib/ShaderProcessor";

// Mock ShaderProcessor
vi.mock("../../lib/ShaderProcessor", () => ({
  ShaderProcessor: vi.fn()
}));

const createMockTimeManager = () => ({
  cleanup: vi.fn(),
});

const createMockRenderingEngine = () => ({
  compileShaderPipeline: vi.fn(),
  cleanup: vi.fn(),
  getTimeManager: vi.fn().mockReturnValue(createMockTimeManager()),
  getCurrentConfig: vi.fn().mockReturnValue(null),
  isLockedShader: vi.fn().mockReturnValue(false),
  togglePause: vi.fn(),
  toggleLock: vi.fn(),
  startRenderLoop: vi.fn(),
  stopRenderLoop: vi.fn(),
  getCurrentFPS: vi.fn().mockReturnValue(60),
  getLockedShaderPath: vi.fn(),
  dispose: vi.fn(),
  getPasses: vi.fn().mockReturnValue([]),
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
  let shaderDebugManager: ShaderDebugManager;
  let mockShaderProcessor: any;

  beforeEach(() => {
    mockRenderingEngine = createMockRenderingEngine();
    mockTransport = createMockTransport();
    mockShaderLocker = createMockShaderLocker();
    shaderDebugManager = new ShaderDebugManager();

    // Mock ShaderProcessor instance
    mockShaderProcessor = {
      processMainShaderCompilation: vi.fn().mockResolvedValue({ success: true }),
      processCommonBufferUpdate: vi.fn().mockResolvedValue({ success: true }),
      debugCompile: vi.fn().mockResolvedValue({ success: true }),
      getImageShaderCode: vi.fn().mockReturnValue(null),
      isCurrentlyProcessing: vi.fn().mockReturnValue(false),
    };

    // Mock ShaderProcessor constructor to return our mock
    (ShaderProcessor as any).mockImplementation(() => mockShaderProcessor);

    // Default: not locked
    mockShaderLocker.isLocked.mockReturnValue(false);

    messageHandler = new MessageHandler(
      mockTransport as unknown as Transport,
      mockRenderingEngine as unknown as RenderingEngine,
      mockShaderLocker as unknown as ShaderLocker,
      shaderDebugManager
    );

    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
  });

  describe("when handleShaderMessage is called", () => {
    it("should set lastEvent and delegate to ShaderProcessor", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(messageHandler.getLastEvent()).toBe(shaderEvent);
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        undefined
      );
    });

    it("should pass forceCleanup=true to ShaderProcessor when forceCleanup is true", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
          forceCleanup: true,
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        true,
        undefined
      );
    });

    it("should pass forceCleanup=false to ShaderProcessor when forceCleanup is false", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
          forceCleanup: false,
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        undefined
      );
    });

    it("should pass forceCleanup=false to ShaderProcessor when forceCleanup is undefined", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        undefined
      );
    });

    it("should ignore cursorPosition events passed through handleShaderMessage", async () => {
      const cursorEvent = {
        data: {
          type: "cursorPosition",
          payload: {
            line: 10,
            character: 0,
            lineContent: "vec3 color = vec3(1.0);",
            filePath: "shader.glsl",
          },
        },
      } as MessageEvent;

      await expect(messageHandler.handleShaderMessage(cursorEvent)).resolves.toBeUndefined();
      expect(mockShaderProcessor.processMainShaderCompilation).not.toHaveBeenCalled();
      expect(mockTransport.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
    });
  });


  describe("setAudioOptions", () => {
    it("should pass audioOptions to ShaderProcessor when processing shader", async () => {
      const audioOptions = { muted: false, volume: 0.75 };
      messageHandler.setAudioOptions(audioOptions);

      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        audioOptions,
      );
    });

    it("should pass updated audioOptions after calling setAudioOptions again", async () => {
      messageHandler.setAudioOptions({ muted: false, volume: 1.0 });
      messageHandler.setAudioOptions({ muted: true, volume: 0 });

      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { muted: true, volume: 0 },
      );
    });

    it("should pass undefined audioOptions when setAudioOptions has not been called", async () => {
      const shaderEvent = {
        data: {
          type: "shaderSource",
          path: "shader.glsl",
          code: "void mainImage() { gl_FragColor = vec4(1.0); }",
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        undefined,
      );
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

    it("should call resetTime on render engine", () => {
      messageHandler.reset();
      expect(mockRenderingEngine.getTimeManager().cleanup).toHaveBeenCalledTimes(1);
    });

    it("should call both cleanup and resetTime", async () => {
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

      mockRenderingEngine.cleanup.mockClear();
      mockRenderingEngine.getTimeManager().cleanup.mockClear();

      messageHandler.reset(vi.fn());

      expect(mockRenderingEngine.cleanup).toHaveBeenCalledTimes(1);
      expect(mockRenderingEngine.getTimeManager().cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe("locking functionality", () => {
    it("should delegate to ShaderProcessor if not locked", async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
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

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        event.data,
        false,
        undefined
      );
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

      expect(mockShaderProcessor.processMainShaderCompilation).not.toHaveBeenCalled();
    });

    it("should delegate to ShaderProcessor when locked and message is for the same locked shader", async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue("locked-shader.glsl");

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

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        event.data,
        false,
        undefined
      );
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

      await messageHandler.handleShaderMessage(event as any);

      expect(mockShaderProcessor.processMainShaderCompilation).not.toHaveBeenCalled();
    });
  });

  describe('Buffer Update Tests', () => {
    let messageHandler: MessageHandler;
    let mockRenderingEngine: any;
    let mockTransport: any;
    let mockShaderLocker: any;
    let shaderDebugManager: ShaderDebugManager;

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
      shaderDebugManager = new ShaderDebugManager();

      messageHandler = new MessageHandler(
        mockTransport,
        mockRenderingEngine,
        mockShaderLocker,
        shaderDebugManager
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
        errors: ['Compilation failed']
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
      const path = 'c:\\mock\\user\\project\\shaders\\gol-buffer.glsl';
      const bufferName = extractBufferNameFromPath(path);
      expect(bufferName).toBe('gol-buffer');
    });

    it('should extract buffer name from Unix path', () => {
      const path = '/mock/home/user/shaders/buffer.glsl';
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

  describe('result handling', () => {
    it('should send warning messages when compilation succeeds with warnings', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: true,
        warnings: ['Video is not loading: video.mp4.', 'Another warning']
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Verify warnings were sent
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'warning',
        payload: ['Video is not loading: video.mp4.']
      });
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'warning',
        payload: ['Another warning']
      });

      // Verify success was also sent
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'log',
        payload: ['Shader compiled and linked']
      });
    });

    it('should send error message when compilation fails', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: false,
        errors: ['Compilation failed']
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['Compilation failed']
      });
    });

    it('should send success message when compilation succeeds', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: true
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'log',
        payload: ['Shader compiled and linked']
      });
    });

    it('should return error result when compilation fails', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: false,
        errors: ['Test error']
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      const result = await messageHandler.handleShaderMessage(event as any);

      expect(result).toEqual({
        success: false,
        errors: ['Test error']
      });
    });

    it('should return success result when compilation succeeds', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: true
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      const result = await messageHandler.handleShaderMessage(event as any);

      expect(result).toEqual({
        success: true
      });
    });

    it('should not send warning messages when warnings is undefined', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: true,
        warnings: undefined
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Verify no warning messages were sent
      const warningCalls = mockTransport.postMessage.mock.calls.filter(
        (call: any) => call[0].type === 'warning'
      );
      expect(warningCalls).toHaveLength(0);

      // Verify success message was sent
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'log',
        payload: ['Shader compiled and linked']
      });
    });

    it('should not send warning messages when warnings array is empty', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.processMainShaderCompilation.mockResolvedValue({
        success: true,
        warnings: []
      });

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Verify no warning messages were sent
      const warningCalls = mockTransport.postMessage.mock.calls.filter(
        (call: any) => call[0].type === 'warning'
      );
      expect(warningCalls).toHaveLength(0);

      // Verify success message was sent
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'log',
        payload: ['Shader compiled and linked']
      });
    });
  });

  describe('cursor position handling', () => {
    it('should extract cursor position from shader message and update debug manager', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
          cursorPosition: {
            line: 5,
            character: 10,
            lineContent: '  vec2 uv = fragCoord / iResolution.xy;',
            filePath: 'shader.glsl'
          }
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Verify debug manager was updated with cursor position
      const debugState = shaderDebugManager.getState();
      expect(debugState.currentLine).toBe(5);
      expect(debugState.lineContent).toBe('  vec2 uv = fragCoord / iResolution.xy;');
      expect(debugState.filePath).toBe('shader.glsl');
    });

    it('should update debug manager via handleCursorPositionMessage', () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const message = {
        type: 'cursorPosition' as const,
        payload: {
          line: 10,
          character: 5,
          lineContent: 'vec3 color = vec3(1.0);',
          filePath: 'test.glsl'
        }
      };

      messageHandler.handleCursorPositionMessage(message);

      const debugState = shaderDebugManager.getState();
      expect(debugState.currentLine).toBe(10);
      expect(debugState.lineContent).toBe('vec3 color = vec3(1.0);');
      expect(debugState.filePath).toBe('test.glsl');
    });

    it('should not update debug manager in handleCursorPositionMessage when locked to different shader', () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('locked.glsl');

      // Set initial state
      shaderDebugManager.updateDebugLine(5, 'initial', 'initial.glsl');
      const initialState = shaderDebugManager.getState();

      const message = {
        type: 'cursorPosition' as const,
        payload: {
          line: 10,
          character: 3,
          lineContent: 'different line',
          filePath: 'different.glsl'
        }
      };

      messageHandler.handleCursorPositionMessage(message);

      // Should not update since cursor is in different file
      const finalState = shaderDebugManager.getState();
      expect(finalState.currentLine).toBe(initialState.currentLine);
      expect(finalState.lineContent).toBe(initialState.lineContent);
      expect(finalState.filePath).toBe(initialState.filePath);
    });

    it('should trigger recompile when debug is active and cursor position changes', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);
      mockShaderProcessor.getImageShaderCode.mockReturnValue('void main() {}');
      shaderDebugManager.toggleEnabled(); // Enable debug mode

      // Process initial shader to set lastEvent
      const initialEvent = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(initialEvent);

      // Clear previous calls
      vi.clearAllMocks();

      // Update cursor position
      const message = {
        type: 'cursorPosition' as const,
        payload: {
          line: 10,
          character: 0,
          lineContent: 'vec3 color = vec3(1.0);',
          filePath: 'shader.glsl'
        }
      };

      messageHandler.handleCursorPositionMessage(message);

      // Should trigger recompile with debug mode
      expect(mockShaderProcessor.debugCompile).toHaveBeenCalledWith(initialEvent.data);
    });

    it('should trigger debug recompile via triggerDebugRecompile', async () => {
      mockShaderProcessor.getImageShaderCode.mockReturnValue('void main() {}');

      // Process initial shader to set lastEvent
      const initialEvent = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(initialEvent);

      // Clear previous calls
      vi.clearAllMocks();

      messageHandler.triggerDebugRecompile();

      expect(mockShaderProcessor.debugCompile).toHaveBeenCalledWith(initialEvent.data);
    });

    it('should not recompile if no original shader code exists', () => {
      mockShaderProcessor.getImageShaderCode.mockReturnValue(null);

      messageHandler.triggerDebugRecompile();

      expect(mockShaderProcessor.debugCompile).not.toHaveBeenCalled();
    });

    it('should delegate to ShaderProcessor when cursor position is provided', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const shaderCode = 'void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }';

      const event = {
        data: {
          type: 'shaderSource',
          code: shaderCode,
          config: null,
          path: 'shader.glsl',
          buffers: {},
          cursorPosition: {
            line: 0,
            character: 0,
            lineContent: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
            filePath: 'shader.glsl'
          }
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Verify delegation to ShaderProcessor
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        event.data,
        false,
        undefined
      );
    });

    it('should not update debug manager when cursor position is from different file and shader is locked', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('locked-shader.glsl');

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'locked-shader.glsl',
          buffers: {},
          cursorPosition: {
            line: 3,
            character: 5,
            lineContent: '  float x = 0.5;',
            filePath: 'different-shader.glsl'  // Different file
          }
        },
      };

      // Set initial state
      shaderDebugManager.updateDebugLine(0, 'initial line', 'initial.glsl');
      const initialState = shaderDebugManager.getState();

      await messageHandler.handleShaderMessage(event as any);

      // Verify debug manager was NOT updated (cursor from different file)
      const finalState = shaderDebugManager.getState();
      expect(finalState.currentLine).toBe(initialState.currentLine);
      expect(finalState.lineContent).toBe(initialState.lineContent);
      expect(finalState.filePath).toBe(initialState.filePath);
    });

    it('should handle shader message without cursor position', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'shader.glsl',
          buffers: {},
          // No cursorPosition field
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Should delegate to ShaderProcessor
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        event.data,
        false,
        undefined
      );
    });

    it('should update debug manager when cursor position is from locked shader', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('locked-shader.glsl');

      const event = {
        data: {
          type: 'shaderSource',
          code: 'void main() {}',
          config: null,
          path: 'locked-shader.glsl',
          buffers: {},
          cursorPosition: {
            line: 7,
            character: 12,
            lineContent: '  vec3 color = vec3(1.0);',
            filePath: 'locked-shader.glsl'  // Same as locked
          }
        },
      };

      await messageHandler.handleShaderMessage(event as any);

      // Verify debug manager WAS updated (cursor from locked file)
      const debugState = shaderDebugManager.getState();
      expect(debugState.currentLine).toBe(7);
      expect(debugState.lineContent).toBe('  vec3 color = vec3(1.0);');
      expect(debugState.filePath).toBe('locked-shader.glsl');
    });
  });

  describe('audioOptions with different volume levels', () => {
    it('should pass volume=0 (fully muted by volume)', async () => {
      const audioOptions = { muted: false, volume: 0 };
      messageHandler.setAudioOptions(audioOptions);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { muted: false, volume: 0 },
      );
    });

    it('should pass volume=0.5 (half volume)', async () => {
      const audioOptions = { muted: false, volume: 0.5 };
      messageHandler.setAudioOptions(audioOptions);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { muted: false, volume: 0.5 },
      );
    });

    it('should pass volume=1.0 (full volume)', async () => {
      const audioOptions = { muted: false, volume: 1.0 };
      messageHandler.setAudioOptions(audioOptions);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { muted: false, volume: 1.0 },
      );
    });
  });

  describe('audioOptions partial updates', () => {
    it('should pass only muted without volume', async () => {
      const audioOptions = { muted: true };
      messageHandler.setAudioOptions(audioOptions);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { muted: true },
      );
    });

    it('should pass only volume without muted', async () => {
      const audioOptions = { volume: 0.8 };
      messageHandler.setAudioOptions(audioOptions);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { volume: 0.8 },
      );
    });

    it('should handle overwriting previous audioOptions entirely', async () => {
      messageHandler.setAudioOptions({ muted: true, volume: 0.3 });
      messageHandler.setAudioOptions({ volume: 0.9 });

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      // The second call should entirely replace the first, not merge
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { volume: 0.9 },
      );
    });
  });

  describe('audioOptions with reset', () => {
    it('should preserve audioOptions after reset', async () => {
      const audioOptions = { muted: false, volume: 0.6 };
      messageHandler.setAudioOptions(audioOptions);

      // Process a shader first so lastEvent is set
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      // Reset
      messageHandler.reset(vi.fn());

      // Clear mocks to check the next call
      mockShaderProcessor.processMainShaderCompilation.mockClear();

      // Process another shader after reset
      const secondEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader2.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(0.5); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(secondEvent);

      // audioOptions should still be passed after reset
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        secondEvent.data,
        false,
        { muted: false, volume: 0.6 },
      );
    });

    it('should call renderEngine.resetTime on reset', () => {
      messageHandler.reset();

      expect(mockRenderingEngine.getTimeManager().cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('audioOptions interaction with shader compilation', () => {
    it('should pass audioOptions on subsequent shader compilations', async () => {
      const audioOptions = { muted: false, volume: 0.75 };
      messageHandler.setAudioOptions(audioOptions);

      // First compilation
      const firstEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader1.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(firstEvent);

      // Second compilation
      const secondEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader2.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(0.5); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(secondEvent);

      // Both compilations should receive audioOptions
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenNthCalledWith(
        1,
        firstEvent.data,
        false,
        audioOptions,
      );
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenNthCalledWith(
        2,
        secondEvent.data,
        false,
        audioOptions,
      );
    });

    it('should handle audioOptions being set before first shader message', async () => {
      const audioOptions = { muted: true, volume: 0 };
      messageHandler.setAudioOptions(audioOptions);

      // No shader has been processed yet, now send first shader
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        { muted: true, volume: 0 },
      );
    });
  });

  describe('locked shader with no buffer content', () => {
    it('should skip processing when locked to different path with empty buffers and no code', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('/mock/locked.glsl');

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/other.glsl',
          code: '',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(result).toBeUndefined();
      expect(mockShaderProcessor.processMainShaderCompilation).not.toHaveBeenCalled();
    });

    it('should skip processing when locked path is undefined and no buffer content', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue(undefined);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/shader.glsl',
          code: '',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(result).toBeUndefined();
    });
  });

  describe('common buffer updates', () => {
    beforeEach(() => {
      mockRenderingEngine.getPasses.mockReturnValue([
        { name: 'Image' },
        { name: 'common' },
      ]);
      (mockRenderingEngine as any).getCurrentConfig = vi.fn().mockReturnValue({
        version: '1',
        passes: {
          Image: { inputs: {} },
          common: { path: 'common.glsl', inputs: {} },
        },
      });
    });

    it('should compile a standalone common file message when unlocked', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/project/common.glsl',
          code: 'float helper() { return 1.0; }',
          config: null,
          buffers: {},
          forceCleanup: true,
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(messageHandler.getLastEvent()).toBe(shaderEvent);
      expect(mockShaderProcessor.processCommonBufferUpdate).not.toHaveBeenCalled();
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        true,
        undefined,
      );
      expect(result).toEqual({ success: true });
    });

    it('should switch unlocked from a runnable shader to a standalone common file message', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const mainShaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/project/image.glsl',
          code: 'void mainImage() { }',
          config: {
            version: '1',
            passes: {
              Image: { inputs: {} },
              common: { path: 'common.glsl', inputs: {} },
            },
          },
          buffers: {
            common: 'float helper() { return 1.0; }',
          },
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(mainShaderEvent);

      mockRenderingEngine.cleanup.mockClear();
      mockShaderProcessor.processMainShaderCompilation.mockClear();
      mockTransport.postMessage.mockClear();

      const commonShaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/project/common.glsl',
          code: 'float helper() { return 1.0; }',
          config: null,
          buffers: {},
          forceCleanup: true,
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(commonShaderEvent);

      expect(messageHandler.getLastEvent()).toBe(commonShaderEvent);
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledTimes(1);
      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        commonShaderEvent.data,
        true,
        undefined,
      );
      expect(result).toEqual({ success: true });
    });

    it('should compile an unmapped file as the active shader when unlocked', async () => {
      mockShaderLocker.isLocked.mockReturnValue(false);

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/project/unmapped-helper-file.glsl',
          code: 'void mainImage() { }',
          config: {
            version: '1',
            passes: {
              Image: { inputs: {} },
              common: { path: 'common.glsl', inputs: {} },
            },
          },
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(mockShaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        shaderEvent.data,
        false,
        undefined,
      );
      expect(result).toEqual({ success: true });
    });

    it('should ignore an unmapped file when locked to a different shader', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('/mock/project/locked-image.glsl');
      const updateBufferSpy = vi.spyOn((messageHandler as any).bufferUpdater, 'updateBuffer');

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/project/unmapped-helper-file.glsl',
          code: 'float helper() { return 1.0; }',
          config: {
            version: '1',
            passes: {
              Image: { inputs: {} },
              common: { path: 'common.glsl', inputs: {} },
            },
          },
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(updateBufferSpy).not.toHaveBeenCalled();
      expect(mockShaderProcessor.processMainShaderCompilation).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should refresh locked shader when common buffer file is updated and shader is locked with path', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('/mock/path/to/locked.glsl');

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: '/mock/project/common.glsl',
          code: 'float helper() { return 1.0; }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(result).toEqual({ success: true });
      expect(mockTransport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refresh', payload: { path: '/mock/path/to/locked.glsl' } })
      );
    });

  });

  describe('refresh', () => {
    it('should send refresh message with path', () => {
      messageHandler.refresh('/mock/path/to/shader.glsl');

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'refresh',
        payload: { path: '/mock/path/to/shader.glsl' },
      });
    });

    it('should send refresh message without path', () => {
      messageHandler.refresh();

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'refresh',
        payload: { path: undefined },
      });
    });
  });

  describe('fatal error handling', () => {
    it('should catch transport errors when sending fatal error message', async () => {
      // Make ShaderProcessor throw
      mockShaderProcessor.processMainShaderCompilation.mockRejectedValue(new Error('catastrophic'));
      // Also make transport.postMessage throw on the error message
      mockTransport.postMessage.mockImplementation(() => {
        throw new Error('transport broken');
      });

      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() {}',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      const result = await messageHandler.handleShaderMessage(shaderEvent);

      expect(result).toEqual({ success: false, errors: ['Fatal error: Error: catastrophic'] });
      expect(console.error).toHaveBeenCalledWith(
        'MessageHandler: Failed to send error message:',
        expect.any(Error)
      );
    });
  });

  describe('debugCompile with existing shader and event', () => {
    it('should compile debug shader when original code and lastEvent exist', async () => {
      // First, process a shader to set lastEvent
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);

      // Now set up debug state
      mockShaderProcessor.getImageShaderCode.mockReturnValue('void mainImage() {}');
      mockShaderProcessor.debugCompile.mockResolvedValue({ success: true });

      // Trigger debug recompile
      messageHandler.triggerDebugRecompile();

      // Wait for async
      await vi.waitFor(() => {
        expect(mockShaderProcessor.debugCompile).toHaveBeenCalledWith(shaderEvent.data);
      });
    });

    it('should send error messages when debug compile fails', async () => {
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() {}',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      await messageHandler.handleShaderMessage(shaderEvent);
      mockTransport.postMessage.mockClear();

      mockShaderProcessor.getImageShaderCode.mockReturnValue('void mainImage() {}');
      mockShaderProcessor.debugCompile.mockResolvedValue({ success: false, errors: ['Debug error'] });

      messageHandler.triggerDebugRecompile();

      await vi.waitFor(() => {
        expect(mockTransport.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error', payload: ['Debug error'] })
        );
      });
    });

    it('should trigger debug recompile from handleCursorPositionMessage when debug is active', async () => {
      // Process shader first
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() {}',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;
      await messageHandler.handleShaderMessage(shaderEvent);

      // Enable debug mode — isActive requires isEnabled + currentLine + lineContent
      mockShaderProcessor.getImageShaderCode.mockReturnValue('void mainImage() {}');
      shaderDebugManager.toggleEnabled();
      shaderDebugManager.updateDebugLine(1, 'float x = 1.0;', 'shader.glsl');

      messageHandler.handleCursorPositionMessage({
        type: 'cursorPosition',
        payload: { line: 5, lineContent: 'float x = 1.0;', filePath: 'shader.glsl' },
      } as any);

      await vi.waitFor(() => {
        expect(mockShaderProcessor.debugCompile).toHaveBeenCalled();
      });
    });
  });
});

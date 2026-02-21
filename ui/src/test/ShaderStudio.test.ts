import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderStudio } from '../lib/ShaderStudio';
import { ShaderLocker } from '../lib/ShaderLocker';
import type { Transport } from '../lib/transport/MessageTransport';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { ErrorMessage, DebugMessage, ShaderSourceMessage } from '@shader-studio/types';

// Mock implementations
describe('ShaderStudio', () => {
  let shaderStudio: ShaderStudio;
  let mockTransport: Transport;
  let mockShaderLocker: ShaderLocker;
  let mockRenderingEngine: RenderingEngine;
  let mockCanvas: HTMLCanvasElement;
  let mockGL: WebGL2RenderingContext;

  beforeEach(() => {
    // Mock Transport
    mockTransport = {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
      dispose: vi.fn(),
      getType: vi.fn().mockReturnValue('websocket'),
      isConnected: vi.fn().mockReturnValue(true)
    };

    // Mock ShaderLocker
    mockShaderLocker = new ShaderLocker();
    vi.spyOn(mockShaderLocker, 'isLocked').mockReturnValue(false);
    vi.spyOn(mockShaderLocker, 'getLockedShaderPath').mockReturnValue(undefined);
    vi.spyOn(mockShaderLocker, 'toggleLock').mockImplementation(() => {});

    // Mock RenderingEngine
    mockRenderingEngine = {
      initialize: vi.fn().mockImplementation(() => {}),
      handleCanvasResize: vi.fn().mockImplementation(() => {}),
      togglePause: vi.fn().mockImplementation(() => {}),
      stopRenderLoop: vi.fn().mockImplementation(() => {}),
      getCurrentFPS: vi.fn().mockReturnValue(60),
      getUniforms: vi.fn().mockReturnValue({ res: [800, 600, 1.333], time: 0, timeDelta: 0, frameRate: 60, mouse: [0, 0, 0, 0], frame: 0, date: [2026, 1, 21, 0] }),
      getTimeManager: vi.fn().mockReturnValue({}),
      dispose: vi.fn().mockImplementation(() => {}),
      compileShaderPipeline: vi.fn(),
      startRenderLoop: vi.fn().mockImplementation(() => {}),
      cleanup: vi.fn().mockImplementation(() => {})
    } as any;

    // Mock Canvas and WebGL context
    mockCanvas = document.createElement('canvas');
    mockGL = {
      // Add minimal WebGL2 context properties
      getExtension: vi.fn(),
      getParameter: vi.fn(),
      createShader: vi.fn(),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(),
      createProgram: vi.fn(),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(),
      useProgram: vi.fn(),
      createBuffer: vi.fn(),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      drawArrays: vi.fn(),
      clear: vi.fn(),
      clearColor: vi.fn(),
      viewport: vi.fn(),
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      COLOR_BUFFER_BIT: 16384
    } as any;

    // Mock getContext
    vi.spyOn(mockCanvas, 'getContext').mockReturnValue(mockGL);

    shaderStudio = new ShaderStudio(mockTransport, mockShaderLocker, mockRenderingEngine);
  });

  describe('constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(shaderStudio).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully with WebGL2 support', async () => {
      const result = await shaderStudio.initialize(mockCanvas);

      expect(result).toBe(true);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('webgl2');
      expect(mockRenderingEngine.initialize).toHaveBeenCalledWith(mockCanvas, true);
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'debug',
        payload: ['Svelte with piLibs initialized']
      });
    });

    it('should return false when WebGL2 is not supported', async () => {
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(null);

      const result = await shaderStudio.initialize(mockCanvas);

      expect(result).toBe(false);
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['❌ WebGL2 not supported']
      });
    });

    it('should handle initialization errors gracefully', async () => {
      const error = new Error('Initialization failed');
      (mockRenderingEngine.initialize as any).mockImplementation(() => {
        throw error;
      });

      const result = await shaderStudio.initialize(mockCanvas);

      expect(result).toBe(false);
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['❌ Renderer initialization failed:', 'Error: Initialization failed']
      });
    });
  });

  describe('handleCanvasResize', () => {
    beforeEach(async () => {
      await shaderStudio.initialize(mockCanvas);
    });

    it('should call rendering engine handleCanvasResize', () => {
      const width = 800;
      const height = 600;

      shaderStudio.handleCanvasResize(width, height);

      expect(mockRenderingEngine.handleCanvasResize).toHaveBeenCalledWith(width, height);
    });

    it('should return early if canvas is not initialized', () => {
      const newShaderStudio = new ShaderStudio(mockTransport, mockShaderLocker, mockRenderingEngine);
      
      newShaderStudio.handleCanvasResize(800, 600);

      expect(mockRenderingEngine.handleCanvasResize).not.toHaveBeenCalled();
    });
  });

  describe('handleShaderMessage', () => {
    beforeEach(async () => {
      await shaderStudio.initialize(mockCanvas);
    });

    it('should delegate to message handler', async () => {
      const mockEvent = {
        data: {
          type: 'shaderSource',
          code: 'test shader code',
          config: {},
          path: 'test.glsl',
          buffers: {}
        }
      } as MessageEvent;

      // Mock the message handler method
      const mockMessageHandler = {
        handleShaderMessage: vi.fn().mockResolvedValue(undefined)
      };
      
      // Replace the message handler property
      Object.defineProperty(shaderStudio, 'messageHandler', {
        value: mockMessageHandler,
        writable: true
      });

      await shaderStudio.handleShaderMessage(mockEvent);

      expect(mockMessageHandler.handleShaderMessage).toHaveBeenCalledWith(mockEvent);
    });
  });

  describe('handleReset', () => {
    beforeEach(async () => {
      await shaderStudio.initialize(mockCanvas);
    });

    it('should call message handler reset with callback', () => {
      const onComplete = vi.fn();
      
      // Mock the message handler method
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        reset: vi.fn()
      });

      shaderStudio.handleReset(onComplete);

      expect((shaderStudio as any).messageHandler.reset).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should call message handler reset without callback', () => {
      // Mock the message handler method
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        reset: vi.fn()
      });

      shaderStudio.handleReset();

      expect((shaderStudio as any).messageHandler.reset).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('handleRefresh', () => {
    beforeEach(async () => {
      await shaderStudio.initialize(mockCanvas);
    });

    it('should refresh locked shader when locked', () => {
      const lockedPath = 'locked-shader.glsl';
      vi.spyOn(mockShaderLocker, 'isLocked').mockReturnValue(true);
      vi.spyOn(mockShaderLocker, 'getLockedShaderPath').mockReturnValue(lockedPath);

      // Mock the message handler method
      const mockRefresh = vi.fn();
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        refresh: mockRefresh
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      shaderStudio.handleRefresh();

      expect(consoleSpy).toHaveBeenCalledWith('Shader Studio: Refreshing locked shader at path:', lockedPath);
      expect(mockRefresh).toHaveBeenCalledWith(lockedPath);
    });

    it('should refresh current shader when not locked', () => {
      vi.spyOn(mockShaderLocker, 'isLocked').mockReturnValue(false);

      // Mock the message handler method
      const mockRefresh = vi.fn();
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        refresh: mockRefresh
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      shaderStudio.handleRefresh();

      expect(consoleSpy).toHaveBeenCalledWith('Shader Studio: Refreshing current shader');
      expect(mockRefresh).toHaveBeenCalledWith();
    });
  });

  describe('handleTogglePause', () => {
    it('should call rendering engine togglePause', () => {
      shaderStudio.handleTogglePause();

      expect(mockRenderingEngine.togglePause).toHaveBeenCalled();
    });
  });

  describe('handleToggleLock', () => {
    beforeEach(async () => {
      await shaderStudio.initialize(mockCanvas);
    });

    it('should toggle lock with shader path from last event', () => {
      const mockEvent = {
        data: {
          type: 'shaderSource',
          code: 'test shader code',
          config: {},
          path: 'test-shader.glsl',
          buffers: {}
        }
      } as MessageEvent;

      // Mock the message handler method
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        getLastEvent: vi.fn().mockReturnValue(mockEvent)
      });

      shaderStudio.handleToggleLock();

      expect(mockShaderLocker.toggleLock).toHaveBeenCalledWith('test-shader.glsl');
    });

    it('should toggle lock without shader path when no last event', () => {
      // Mock the message handler method
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        getLastEvent: vi.fn().mockReturnValue(null)
      });

      shaderStudio.handleToggleLock();

      expect(mockShaderLocker.toggleLock).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getIsLocked', () => {
    it('should return shader locker isLocked status', () => {
      vi.spyOn(mockShaderLocker, 'isLocked').mockReturnValue(true);

      const result = shaderStudio.getIsLocked();

      expect(result).toBe(true);
      expect(mockShaderLocker.isLocked).toHaveBeenCalled();
    });
  });

  describe('stopRenderLoop', () => {
    it('should call rendering engine stopRenderLoop', () => {
      shaderStudio.stopRenderLoop();

      expect(mockRenderingEngine.stopRenderLoop).toHaveBeenCalled();
    });
  });

  describe('getCurrentFPS', () => {
    it('should return rendering engine current FPS', () => {
      const fps = 75;
      vi.spyOn(mockRenderingEngine, 'getCurrentFPS').mockReturnValue(fps);

      const result = shaderStudio.getCurrentFPS();

      expect(result).toBe(fps);
      expect(mockRenderingEngine.getCurrentFPS).toHaveBeenCalled();
    });
  });

  describe('getUniforms', () => {
    it('should delegate to rendering engine getUniforms', () => {
      const mockUniforms = { res: [1920, 1080, 1.778], time: 5.0, timeDelta: 0.016, frameRate: 60, mouse: [100, 200, 0, 0], frame: 300, date: [2026, 1, 21, 45000] };
      vi.spyOn(mockRenderingEngine, 'getUniforms').mockReturnValue(mockUniforms);

      const result = shaderStudio.getUniforms();

      expect(result).toBe(mockUniforms);
      expect(mockRenderingEngine.getUniforms).toHaveBeenCalled();
    });
  });

  describe('getLastShaderEvent', () => {
    beforeEach(async () => {
      await shaderStudio.initialize(mockCanvas);
    });

    it('should return last event from message handler', () => {
      const mockEvent = {
        data: {
          type: 'shaderSource',
          code: 'test shader code',
          config: {},
          path: 'test.glsl',
          buffers: {}
        }
      } as MessageEvent;

      // Mock the message handler method
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        getLastEvent: vi.fn().mockReturnValue(mockEvent)
      });

      const result = shaderStudio.getLastShaderEvent();

      expect(result).toBe(mockEvent);
    });
  });

  describe('getTimeManager', () => {
    it('should return time manager from rendering engine', () => {
      const mockTimeManager = {
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
        cleanup: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(0),
        updateFrame: vi.fn(),
        getDeltaTime: vi.fn().mockReturnValue(0.016),
        getFrame: vi.fn().mockReturnValue(0),
        incrementFrame: vi.fn(),
        getCurrentDate: vi.fn().mockReturnValue(new Float32Array([2024, 0, 1, 0]))
      } as any;
      vi.spyOn(mockRenderingEngine, 'getTimeManager').mockReturnValue(mockTimeManager);

      const result = shaderStudio.getTimeManager();

      expect(result).toBe(mockTimeManager);
      expect(mockRenderingEngine.getTimeManager).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should call rendering engine dispose', () => {
      shaderStudio.dispose();

      expect(mockRenderingEngine.dispose).toHaveBeenCalled();
    });

    it('should handle disposal when rendering engine is undefined', () => {
      const shaderStudioWithoutEngine = new ShaderStudio(mockTransport, mockShaderLocker, undefined as any);
      
      expect(() => shaderStudioWithoutEngine.dispose()).not.toThrow();
    });
  });

  describe('initialization', () => {
    it('should successfully initialize', async () => {
      const result = await shaderStudio.initialize(mockCanvas);

      expect(result).toBe(true);
      const messageHandler = (shaderStudio as any).messageHandler;
      expect(messageHandler).toBeDefined();
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Render init failed');
      (mockRenderingEngine.initialize as any).mockImplementation(() => {
        throw error;
      });

      const result = await shaderStudio.initialize(mockCanvas);

      expect(result).toBe(false);
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['❌ Renderer initialization failed:', 'Error: Render init failed']
      });
    });

    it('should handle WebGL2 not supported error', async () => {
      vi.spyOn(mockCanvas, 'getContext').mockReturnValue(null);

      const result = await shaderStudio.initialize(mockCanvas);

      expect(result).toBe(false);
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['❌ WebGL2 not supported']
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete initialization and basic operations', async () => {
      // Initialize
      const initResult = await shaderStudio.initialize(mockCanvas);
      expect(initResult).toBe(true);

      // Handle resize
      shaderStudio.handleCanvasResize(1024, 768);
      expect(mockRenderingEngine.handleCanvasResize).toHaveBeenCalledWith(1024, 768);

      // Toggle pause
      shaderStudio.handleTogglePause();
      expect(mockRenderingEngine.togglePause).toHaveBeenCalled();

      // Get FPS
      const fps = shaderStudio.getCurrentFPS();
      expect(fps).toBe(60);

      // Dispose
      shaderStudio.dispose();
      expect(mockRenderingEngine.dispose).toHaveBeenCalled();
    });

    it('should handle lock/unlock workflow', async () => {
      await shaderStudio.initialize(mockCanvas);

      const mockEvent = {
        data: {
          type: 'shaderSource',
          code: 'test shader code',
          config: {},
          path: 'workflow-test.glsl',
          buffers: {}
        }
      } as MessageEvent;

      // Mock message handler
      vi.spyOn(shaderStudio as any, 'messageHandler', 'get').mockReturnValue({
        getLastEvent: vi.fn().mockReturnValue(mockEvent),
        refresh: vi.fn()
      });

      // Toggle lock on
      shaderStudio.handleToggleLock();
      expect(mockShaderLocker.toggleLock).toHaveBeenCalledWith('workflow-test.glsl');

      // Check locked status
      vi.spyOn(mockShaderLocker, 'isLocked').mockReturnValue(true);
      vi.spyOn(mockShaderLocker, 'getLockedShaderPath').mockReturnValue('workflow-test.glsl');
      expect(shaderStudio.getIsLocked()).toBe(true);

      // Refresh (should refresh locked shader)
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      shaderStudio.handleRefresh();
      expect(consoleSpy).toHaveBeenCalledWith('Shader Studio: Refreshing locked shader at path:', 'workflow-test.glsl');
    });

    it('should handle error callback workflow', async () => {
      const onError = vi.fn();
      const onSuccess = vi.fn();

      const shaderStudioWithCallbacks = new ShaderStudio(
        mockTransport,
        mockShaderLocker,
        mockRenderingEngine,
        undefined as any,
        onError,
        onSuccess
      );

      await shaderStudioWithCallbacks.initialize(mockCanvas);

      // The callbacks should be available for MessageHandler to use
      expect(shaderStudioWithCallbacks).toBeDefined();
      expect((shaderStudioWithCallbacks as any).messageHandler).toBeDefined();
    });
  });
});

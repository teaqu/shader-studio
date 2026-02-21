import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderProcessor } from '../lib/ShaderProcessor';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { ShaderDebugManager } from '../lib/ShaderDebugManager';
import type { ShaderSourceMessage } from '@shader-studio/types';

describe('ShaderProcessor', () => {
  let shaderProcessor: ShaderProcessor;
  let mockRenderEngine: RenderingEngine;
  let mockShaderDebugManager: ShaderDebugManager;

  beforeEach(() => {
    // Mock ShaderDebugManager
    mockShaderDebugManager = {
      getState: vi.fn().mockReturnValue({
        isEnabled: false,
        isActive: false,
        currentLine: null,
        lineContent: null,
        filePath: null,
      }),
      modifyShaderForDebugging: vi.fn(),
      updateDebugLine: vi.fn(),
      toggleEnabled: vi.fn(),
      setStateCallback: vi.fn(),
      setOriginalCode: vi.fn(),
    } as any;

    // Mock RenderingEngine
    mockRenderEngine = {
      stopRenderLoop: vi.fn(),
      startRenderLoop: vi.fn(),
      cleanup: vi.fn(),
      compileShaderPipeline: vi.fn().mockResolvedValue({
        success: true,
        warnings: [],
      }),
      updateBufferAndRecompile: vi.fn().mockResolvedValue({
        success: true,
      }),
    } as any;

    shaderProcessor = new ShaderProcessor(
      mockRenderEngine,
      mockShaderDebugManager
    );
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(shaderProcessor).toBeDefined();
    });
  });

  describe('isCurrentlyProcessing', () => {
    it('should return false initially', () => {
      expect(shaderProcessor.isCurrentlyProcessing()).toBe(false);
    });

    it('should return true while processing', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      // Make compilation take time
      (mockRenderEngine.compileShaderPipeline as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      const processPromise = shaderProcessor.processMainShaderCompilation(message, false);

      // Should be processing
      expect(shaderProcessor.isCurrentlyProcessing()).toBe(true);

      await processPromise;

      // Should be done processing
      expect(shaderProcessor.isCurrentlyProcessing()).toBe(false);
    });
  });

  describe('getOriginalShaderCode', () => {
    it('should return null initially', () => {
      expect(shaderProcessor.getOriginalShaderCode()).toBeNull();
    });

    it('should return shader code after processing', async () => {
      const shaderCode = 'void mainImage() {}';
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: shaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(shaderProcessor.getOriginalShaderCode()).toBe(shaderCode);
    });
  });

  describe('processMainShaderCompilation', () => {
    it('should compile shader successfully', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.stopRenderLoop).toHaveBeenCalled();
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers
      );
      expect(mockRenderEngine.startRenderLoop).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should cleanup when forceCleanup is true', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, true);

      expect(mockRenderEngine.cleanup).toHaveBeenCalled();
    });

    it('should not cleanup when forceCleanup is false', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.cleanup).not.toHaveBeenCalled();
    });

    it('should handle compilation errors', async () => {
      const errorMessage = 'Shader compilation failed';
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        error: errorMessage,
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'invalid shader code',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it('should return warnings when compilation succeeds with warnings', async () => {
      const warnings = ['Warning 1', 'Warning 2'];
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: true,
        warnings,
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(warnings);
    });

    it('should compile with debug mode when active', async () => {
      const originalCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'test.glsl',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: originalCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockShaderDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(originalCode, 5);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        modifiedCode,
        message.config,
        message.path,
        message.buffers
      );
    });

    it('should fallback to original code if debug compilation fails', async () => {
      const originalCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'test.glsl',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      // First call (debug) fails, second call (original) succeeds
      (mockRenderEngine.compileShaderPipeline as any)
        .mockResolvedValueOnce({ success: false, error: 'Debug compilation failed' })
        .mockResolvedValueOnce({ success: true });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: originalCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledTimes(2);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenNthCalledWith(1, modifiedCode, message.config, message.path, message.buffers);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenNthCalledWith(2, originalCode, message.config, message.path, message.buffers);
      expect(result.success).toBe(true);
    });

    it('should handle exceptions during compilation', async () => {
      const error = new Error('Unexpected error');
      (mockRenderEngine.compileShaderPipeline as any).mockRejectedValue(error);

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.error).toBe(`Shader compilation error: ${error}`);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });
  });

  describe('processCommonBufferUpdate', () => {
    it('should update common buffer successfully', async () => {
      const code = 'float common() { return 1.0; }';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(mockRenderEngine.stopRenderLoop).toHaveBeenCalled();
      expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith('common', code);
      expect(mockRenderEngine.startRenderLoop).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle common buffer update errors', async () => {
      const errorMessage = 'Common buffer compilation failed';
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
        success: false,
        error: errorMessage,
      });

      const code = 'invalid common code';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it('should handle exceptions during common buffer update', async () => {
      const error = new Error('Unexpected error');
      (mockRenderEngine.updateBufferAndRecompile as any).mockRejectedValue(error);

      const code = 'float common() { return 1.0; }';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(result.success).toBe(false);
      expect(result.error).toBe(`Common buffer update error: ${error}`);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });
  });

  describe('debugCompile', () => {
    it('should return success if no original shader code exists', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.debugCompile(message);

      expect(result.success).toBe(true);
      expect(mockRenderEngine.compileShaderPipeline).not.toHaveBeenCalled();
    });

    it('should compile with original code when debug mode is inactive', async () => {
      const originalCode = 'void mainImage() {}';

      // First compile to set original code
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: originalCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      // Reset mocks
      vi.clearAllMocks();

      // Debug mode is inactive
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: false,
        isActive: false,
        currentLine: null,
        lineContent: null,
        filePath: null,
      });

      const result = await shaderProcessor.debugCompile(message);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        originalCode,
        message.config,
        message.path,
        message.buffers
      );
      expect(result.success).toBe(true);
    });

    it('should compile with modified code when debug mode is active', async () => {
      const originalCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      // First compile to set original code
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: originalCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      // Reset mocks
      vi.clearAllMocks();

      // Debug mode is active
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 10,
        lineContent: 'debug line',
        filePath: 'test.glsl',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      const result = await shaderProcessor.debugCompile(message);

      expect(mockShaderDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(originalCode, 10);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        modifiedCode,
        message.config,
        message.path,
        message.buffers
      );
      expect(result.success).toBe(true);
    });

    it('should fallback to original code if modification fails', async () => {
      const originalCode = 'void mainImage() {}';

      // First compile to set original code
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: originalCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      // Reset mocks
      vi.clearAllMocks();

      // Debug mode is active but modification returns null
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 10,
        lineContent: 'debug line',
        filePath: 'test.glsl',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(null);

      const result = await shaderProcessor.debugCompile(message);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        originalCode,
        message.config,
        message.path,
        message.buffers
      );
      expect(result.success).toBe(true);
    });
  });
});

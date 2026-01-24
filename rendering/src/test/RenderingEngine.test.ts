import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../RenderingEngine";
import { ConfigValidator } from "../util/ConfigValidator";
import type { ShaderConfig } from "@shader-studio/types";

// Mock the ConfigValidator
vi.mock("../util/ConfigValidator", () => ({
  ConfigValidator: {
    validateConfig: vi.fn()
  }
}));

describe("RenderingEngine", () => {
  let renderingEngine: RenderingEngine;
  let mockFrameRenderer: any;

  beforeEach(() => {
    renderingEngine = new RenderingEngine();
    vi.spyOn(console, "log").mockImplementation(() => { });

    mockFrameRenderer = {
      startRenderLoop: vi.fn(),
      stopRenderLoop: vi.fn(),
    };

    Object.defineProperty(renderingEngine, 'frameRenderer', {
      value: mockFrameRenderer,
      writable: true,
      configurable: true
    });
  });

  describe("config validation", () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
      };
      // Mock the private shaderPipeline property
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline,
        writable: true,
        configurable: true
      });

      // Reset the mock before each test
      vi.clearAllMocks();
    });

    it("should validate config before processing", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });

      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        config,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).toHaveBeenCalledWith(config);
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });

    it("should reject compilation when config validation fails", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({
        isValid: false,
        errors: ['Test validation error']
      });

      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      const result = await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        config,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).toHaveBeenCalledWith(config);
      expect(result!.success).toBe(false);
      expect(result!.error).toContain('Invalid shader configuration: Test validation error');
      expect(mockPipeline.compileShaderPipeline).not.toHaveBeenCalled();
    });

    it("should not validate null config", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);

      await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        null,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).not.toHaveBeenCalled();
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });
  });

  describe('Buffer Update Tests', () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        getPasses: vi.fn(() => [
          { name: 'Image', shaderSrc: 'void main() {}' },
          { name: 'BufferA', shaderSrc: 'original buffer content' }
        ]),
        getShaderPath: vi.fn(() => 'test.glsl')
      };
      
      // Mock the private shaderPipeline property
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline,
        writable: true,
        configurable: true
      });

      // Mock ConfigValidator to prevent validation errors
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });

      // Reset the mock before each test
      vi.clearAllMocks();
    });

    it('should return current config via getCurrentConfig', () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Set the config by calling compileShaderPipeline
      renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        {}
      );

      const currentConfig = renderingEngine.getCurrentConfig();
      expect(currentConfig).toEqual(testConfig);
    });

    it('should update buffer and recompile via updateBufferAndRecompile', async () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Initialize with a config
      await renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        { BufferA: 'original buffer content' }
      );

      // Mock the pipeline compilation for buffer update
      const mockCompileResult = { success: true };
      mockPipeline.compileShaderPipeline.mockResolvedValue(mockCompileResult);

      // Update buffer
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'updated buffer content'
      );

      expect(result).toEqual({ success: true });
      
      // Check the second call (buffer update) specifically
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(2);
      const bufferUpdateCall = mockPipeline.compileShaderPipeline.mock.calls[1];
      expect(bufferUpdateCall).toEqual([
        'void main() {}', // imagePass.shaderSrc
        testConfig,
        'test.glsl',
        { BufferA: 'updated buffer content' } // updated buffers
      ]);
    });

    it('should handle buffer update compilation failure', async () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Initialize with a config
      await renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        { BufferA: 'original content' }
      );

      // Mock compilation failure
      const mockCompileResult = { 
        success: false, 
        error: 'Buffer compilation failed' 
      };
      mockPipeline.compileShaderPipeline.mockResolvedValue(mockCompileResult);

      // Update buffer
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'broken buffer content'
      );

      expect(result).toEqual({ 
        success: false, 
        error: 'Buffer compilation failed' 
      });
    });

    it('should handle buffer update when no config is set', async () => {
      // Don't initialize with any config - but set up mock pipeline
      mockPipeline.getPasses.mockReturnValue([]);
      
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'some content'
      );

      expect(result).toEqual({
        success: false,
        error: "Buffer 'BufferA' not found in current shader"
      });
    });
  });
});

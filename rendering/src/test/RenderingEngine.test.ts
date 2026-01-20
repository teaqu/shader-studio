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
});

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

  beforeEach(() => {
    renderingEngine = new RenderingEngine();
    vi.spyOn(console, "log").mockImplementation(() => {});
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

  describe("shader locker integration", () => {
    describe("when checking lock state", () => {
      it("then should not be locked initially", () => {
        expect(renderingEngine.isLockedShader()).toBe(false);
      });
    });

    describe("when toggling lock", () => {
      it("then should toggle lock state", () => {
        renderingEngine.toggleLock("test.glsl");
        expect(renderingEngine.isLockedShader()).toBe(true);

        renderingEngine.toggleLock("test.glsl"); // toggle off by calling with same path
        expect(renderingEngine.isLockedShader()).toBe(false);
      });
    });

    describe("when checking locked shader path", () => {
      it("then should return undefined when not locked", () => {
        expect(renderingEngine.getLockedShaderPath()).toBe(undefined);
      });

      it("then should return the locked shader path when locked", () => {
        renderingEngine.toggleLock("test.glsl");
        expect(renderingEngine.getLockedShaderPath()).toBe("test.glsl");

        renderingEngine.toggleLock("test.glsl"); // unlock
        expect(renderingEngine.getLockedShaderPath()).toBe(undefined);
      });
    });

    describe("when handling shader compilation", () => {
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

        // Reset the ConfigValidator mock
        const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
        mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });
      });

      it("then should process shader when not locked", async () => {
        const shaderConfig = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {},
            },
          },
        };

        const result = await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "test.glsl",
          {}
        );
        expect(result!.success).toBe(true);
        expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
      });

      it("then should ignore different shader when locked", async () => {
        const shaderConfig = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {},
            },
          },
        };

        // First compilation to establish lock
        await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "first.glsl",
          {}
        );
        renderingEngine.toggleLock("first.glsl");

        // Try to compile a different shader - should be ignored
        const result = await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "different.glsl",
          {}
        );

        // Should not compile the different shader
        expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
        expect(result!.success).toBe(false);
      });

      it("then should process same shader when locked", async () => {
        const shaderConfig = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {},
            },
          },
        };

        // First compilation to establish lock
        await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "test.glsl",
          {}
        );
        renderingEngine.toggleLock("test.glsl");

        // Try to compile the same shader - should work
        const result = await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "test.glsl",
          {}
        );

        expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(2);
        expect(result!.success).toBe(true);
      });

      it("then should process all shaders after unlocking", async () => {
        const shaderConfig = {
          version: "1.0",
          passes: {
            Image: {
              inputs: {},
            },
          },
        };

        // First compilation and lock
        await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "first.glsl",
          {}
        );
        renderingEngine.toggleLock("first.glsl");

        // Unlock by toggling again
        renderingEngine.toggleLock("first.glsl");

        // Try to compile a different shader - should work now
        const result = await renderingEngine.compileShaderPipeline(
          "void mainImage() {}",
          shaderConfig,
          "second.glsl",
          {}
        );

        expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(2);
        expect(result!.success).toBe(true);
      });
    });
  });
});

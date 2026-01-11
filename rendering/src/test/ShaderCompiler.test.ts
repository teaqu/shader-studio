import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShaderCompiler } from "../ShaderCompiler";
import type { PiRenderer, PiShader } from "../types/piRenderer";

const createMockRenderer = () => ({
  CreateShader: vi.fn(),
}) as unknown as PiRenderer;

const createMockShader = () => ({
  mResult: true,
  mInfo: "",
}) as unknown as PiShader;

describe("ShaderCompiler", () => {
  let shaderCompiler: ShaderCompiler;
  let mockRenderer: ReturnType<typeof createMockRenderer>;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    shaderCompiler = new ShaderCompiler(mockRenderer);
  });

  describe("wrapShaderToyCode", () => {
    it("should always include HW_PERFORMANCE define set to 1", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("#define HW_PERFORMANCE 1");
    });

    it("should include HW_PERFORMANCE before any user code", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      const hwPerfIndex = wrappedCode.indexOf("#define HW_PERFORMANCE 1");
      const userCodeIndex = wrappedCode.indexOf("void mainImage");

      expect(hwPerfIndex).toBeGreaterThan(-1);
      expect(userCodeIndex).toBeGreaterThan(-1);
      expect(hwPerfIndex).toBeLessThan(userCodeIndex);
    });

    it("should include standard Shadertoy uniforms", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("uniform vec3 iResolution;");
      expect(wrappedCode).toContain("uniform float iTime;");
    });

    it("should inject all uniforms that match PassRenderer expectations", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // Verify all uniforms that PassRenderer.renderPass() sets values for
      expect(wrappedCode).toContain("uniform vec3 iResolution;");  // SetShaderConstant3FV
      expect(wrappedCode).toContain("uniform float iTime;");        // SetShaderConstant1F
      expect(wrappedCode).toContain("uniform float iTimeDelta;");   // SetShaderConstant1F
      expect(wrappedCode).toContain("uniform float iFrameRate;");   // SetShaderConstant1F
      expect(wrappedCode).toContain("uniform vec4 iMouse;");        // SetShaderConstant4FV
      expect(wrappedCode).toContain("uniform int iFrame;");         // SetShaderConstant1I
      expect(wrappedCode).toContain("uniform vec4 iDate;");         // SetShaderConstant4FV
      
      // Channel samplers
      expect(wrappedCode).toContain("uniform sampler2D iChannel0;"); // SetShaderTextureUnit
      expect(wrappedCode).toContain("uniform sampler2D iChannel1;"); // SetShaderTextureUnit
      expect(wrappedCode).toContain("uniform sampler2D iChannel2;"); // SetShaderTextureUnit
      expect(wrappedCode).toContain("uniform sampler2D iChannel3;"); // SetShaderTextureUnit
    });

    it("should not inject uniforms that are already declared", () => {
      const code = `
        uniform vec4 iMouse;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // Count occurrences of iMouse uniform
      const matches = wrappedCode.match(/uniform\s+vec4\s+iMouse\s*;/g);
      expect(matches).toHaveLength(1);
    });

    it("should not inject any uniform if all are already declared", () => {
      const code = `
        uniform vec4 iMouse;
        uniform int iFrame;
        uniform float iTimeDelta;
        uniform float iFrameRate;
        uniform vec4 iDate;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // Each uniform should appear exactly once
      expect(wrappedCode.match(/uniform\s+vec4\s+iMouse\s*;/g)).toHaveLength(1);
      expect(wrappedCode.match(/uniform\s+int\s+iFrame\s*;/g)).toHaveLength(1);
      expect(wrappedCode.match(/uniform\s+float\s+iTimeDelta\s*;/g)).toHaveLength(1);
      expect(wrappedCode.match(/uniform\s+float\s+iFrameRate\s*;/g)).toHaveLength(1);
      expect(wrappedCode.match(/uniform\s+vec4\s+iDate\s*;/g)).toHaveLength(1);
    });

    it("should inject missing channel samplers", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("uniform sampler2D iChannel0;");
      expect(wrappedCode).toContain("uniform sampler2D iChannel1;");
      expect(wrappedCode).toContain("uniform sampler2D iChannel2;");
      expect(wrappedCode).toContain("uniform sampler2D iChannel3;");
    });

    it("should not inject channel samplers that are already declared", () => {
      const code = `
        uniform sampler2D iChannel0;
        uniform sampler2D iChannel2;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // Only iChannel1 and iChannel3 should be injected
      expect(wrappedCode.match(/uniform\s+sampler2D\s+iChannel0\s*;/g)).toHaveLength(1);
      expect(wrappedCode).toContain("uniform sampler2D iChannel1;");
      expect(wrappedCode.match(/uniform\s+sampler2D\s+iChannel2\s*;/g)).toHaveLength(1);
      expect(wrappedCode).toContain("uniform sampler2D iChannel3;");
    });

    it("should wrap user code with main function", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("void main() {");
      expect(wrappedCode).toContain("mainImage(fragColor, gl_FragCoord.xy);");
      expect(wrappedCode).toContain("}");
    });

    it("should return correct header line count", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { headerLineCount } = shaderCompiler.wrapShaderToyCode(code);

      expect(headerLineCount).toBeGreaterThan(0);
      expect(typeof headerLineCount).toBe("number");
    });

    it("should preserve user preprocessor directives", () => {
      const code = `
        #define MY_CONSTANT 42
        #define MY_MACRO(x) (x * 2.0)
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("#define MY_CONSTANT 42");
      expect(wrappedCode).toContain("#define MY_MACRO(x) (x * 2.0)");
    });
  });

  describe("compileShader", () => {
    it("should call renderer CreateShader with wrapped code", () => {
      const mockShader = createMockShader();
      (mockRenderer.CreateShader as any).mockReturnValue(mockShader);

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const result = shaderCompiler.compileShader(code);

      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockShader);
    });

    it("should ensure HW_PERFORMANCE is defined in compiled shader", () => {
      (mockRenderer.CreateShader as any).mockImplementation((vs: string, fs: string) => {
        expect(fs).toContain("#define HW_PERFORMANCE 1");
        return createMockShader();
      });

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      shaderCompiler.compileShader(code);

      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);
    });
  });
});

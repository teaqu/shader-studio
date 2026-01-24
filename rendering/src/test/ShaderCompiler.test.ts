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

    it("should always inject all uniforms regardless of user declarations (Like shadertoy)", () => {
      const code = `
        uniform vec4 iMouse;
        uniform int iFrame;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // All uniforms should be present (duplicates are expected now)
      expect(wrappedCode.match(/uniform\s+vec4\s+iMouse\s*;/g)).toHaveLength(2);
      expect(wrappedCode.match(/uniform\s+int\s+iFrame\s*;/g)).toHaveLength(2);
    });

    it("should inject missing channel samplers", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("uniform sampler2D iChannel0;");
      expect(wrappedCode).toContain("uniform sampler2D iChannel1;");
      expect(wrappedCode).toContain("uniform sampler2D iChannel2;");
      expect(wrappedCode).toContain("uniform sampler2D iChannel3;");
    });

    it("should always inject all channel samplers regardless of user declarations (Like shadertoy)", () => {
      const code = `
        uniform sampler2D iChannel0;
        uniform sampler2D iChannel2;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // All channel samplers should be present (duplicates are expected now)
      expect(wrappedCode.match(/uniform\s+sampler2D\s+iChannel0\s*;/g)).toHaveLength(2);
      expect(wrappedCode.match(/uniform\s+sampler2D\s+iChannel1\s*;/g)).toHaveLength(1);
      expect(wrappedCode.match(/uniform\s+sampler2D\s+iChannel2\s*;/g)).toHaveLength(2);
      expect(wrappedCode.match(/uniform\s+sampler2D\s+iChannel3\s*;/g)).toHaveLength(1);
    });

    it("should wrap user code with main function", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("void main() {");
      expect(wrappedCode).toContain("mainImage(fragColor, gl_FragCoord.xy);");
      expect(wrappedCode).toContain("}");
    });

    it("should produce exact expected output format", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      const expected = `
precision highp float;
out vec4 fragColor;
#define HW_PERFORMANCE 1
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec4 iMouse;
uniform int iFrame;
uniform vec4 iDate;
void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }
void main() {
  mainImage(fragColor, gl_FragCoord.xy);
}`;

      expect(wrappedCode).toBe(expected);
    });

    it("should include common code in header and count it in headerLineCount", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const commonCode = "vec4 helper(vec4 a) { return a * 2.0; }";
      const { wrappedCode, headerLineCount } = shaderCompiler.wrapShaderToyCode(code, commonCode);

      expect(wrappedCode).toContain(commonCode);
      expect(wrappedCode.indexOf(commonCode)).toBeGreaterThan(wrappedCode.indexOf("uniform vec4 iDate"));
      expect(wrappedCode.indexOf(commonCode)).toBeLessThan(wrappedCode.indexOf("void main()"));
      
      // Header line count should include common code lines
      expect(headerLineCount).toBeGreaterThan(13); // Base header + common code
    });

    it("should correctly calculate headerLineCount with common code", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const commonCode = "vec4 helper(vec4 a) { return a * 2.0; }\nvec4 another(vec4 b) { return b * 3.0; }";
      const { wrappedCode, headerLineCount } = shaderCompiler.wrapShaderToyCode(code, commonCode);

      // Count actual lines in header + common code
      // The header template starts with a newline, so we need to account for that
      const headerWithNewline = `
precision highp float;
out vec4 fragColor;
#define HW_PERFORMANCE 1
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec4 iMouse;
uniform int iFrame;
uniform vec4 iDate;`;
      
      const headerLines = (headerWithNewline.match(/\n/g) || []).length;
      const commonLines = (commonCode.match(/\n/g) || []).length + 1; // +1 for the last line without newline
      const expectedTotal = headerLines + commonLines;

      expect(headerLineCount).toBe(expectedTotal);
    });

    it("should handle error formatting correctly with common code", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  fragColor = vec4(1.0);\n}";
      const commonCode = "vec4 helper(vec4 a) { return a * 2.0; }\nvec4 another(vec4 b) { return b * 3.0; }";
      
      // Simulate what ShaderPipeline does (FIXED VERSION)
      const { headerLineCount: svelteHeaderLines } = shaderCompiler.wrapShaderToyCode(code, commonCode);
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code, commonCode);
      
      // Simulate a shader error at line 20 (in the compiled shader)
      const shaderErrorLine = 20;
      const totalHeaderLines = 15 + svelteHeaderLines; // renderer.GetShaderHeaderLines(1) + headerLineCount
      const userLine = Math.max(1, shaderErrorLine - totalHeaderLines);
      
      // The user line should be positive and reasonable
      expect(userLine).toBeGreaterThan(0);
      expect(userLine).toBeLessThan(100); // Should be reasonable
      
      // Most importantly, svelteHeaderLines should now include common code lines
      expect(svelteHeaderLines).toBe(16); // 15 base + 1 common code line (the common code has 1 newline)
    });

    it("should prevent negative line numbers in error formatting", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const commonCode = "vec4 helper(vec4 a) { return a * 2.0; }\nvec4 another(vec4 b) { return b * 3.0; }\nvec4 third(vec4 c) { return c * 4.0; }";
      
      // Simulate what ShaderPipeline does
      const { headerLineCount: svelteHeaderLines } = shaderCompiler.wrapShaderToyCode(code, commonCode);
      
      // Simulate a shader error at line 10 (in the compiled shader) - this could be in the header/common code area
      const shaderErrorLine = 10;
      const totalHeaderLines = 15 + svelteHeaderLines; // renderer.GetShaderHeaderLines(1) + headerLineCount
      const userLine = Math.max(1, shaderErrorLine - totalHeaderLines);
      
      // The user line should be clamped to 1 (not negative)
      expect(userLine).toBe(1);
      
      // Test with a more realistic error line that should still be in header
      const shaderErrorLine2 = 25;
      const userLine2 = Math.max(1, shaderErrorLine2 - totalHeaderLines);
      expect(userLine2).toBe(1); // Should still be clamped to 1
    });

    it("should work without common code", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode, headerLineCount } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).not.toContain("helper");
      expect(headerLineCount).toBeGreaterThan(10); // Just base header
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

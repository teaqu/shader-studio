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

it("should always inject all uniforms regardless of user declarations (Like ShaderToy)", () => {
      const code = `
        uniform vec4 iMouse;
        uniform int iFrame;
        uniform float iTimeDelta;
        uniform float iFrameRate;
        uniform vec4 iDate;
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {}
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode.match(/uniform\s+vec4\s+iMouse\s*;/g)).toHaveLength(2);
      expect(wrappedCode.match(/uniform\s+int\s+iFrame\s*;/g)).toHaveLength(2);
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

    it("should validate complete wrapped shader output structure", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }";
      const { wrappedCode, headerLineCount } = shaderCompiler.wrapShaderToyCode(code);

      // Verify the complete expected structure
      const expectedStructure = [
        "precision highp float;",
        "out vec4 fragColor;",
        "#define HW_PERFORMANCE 1",
        "uniform vec3 iResolution;",
        "uniform float iTime;",
        "uniform float iTimeDelta;",
        "uniform float iFrameRate;",
        "uniform sampler2D iChannel0;",
        "uniform sampler2D iChannel1;",
        "uniform sampler2D iChannel2;",
        "uniform sampler2D iChannel3;",
        "uniform vec4 iMouse;",
        "uniform int iFrame;",
        "uniform vec4 iDate;",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }",
        "void main() {",
        " mainImage(fragColor, gl_FragCoord.xy);",
        "}"
      ];

      expectedStructure.forEach(expectedLine => {
        expect(wrappedCode).toContain(expectedLine);
      });

      // Verify the exact order and structure
      const lines = wrappedCode.split('\n').filter(line => line.trim());
      expect(lines).toContain("precision highp float;");
      expect(lines).toContain("out vec4 fragColor;");
      expect(lines).toContain("#define HW_PERFORMANCE 1");
      expect(lines[lines.length - 3]).toContain("void main() {");
      expect(lines[lines.length - 2]).toContain("mainImage(fragColor, gl_FragCoord.xy);");
      expect(lines[lines.length - 1]).toContain("}");

      // Verify header line count is accurate
      const actualHeaderLines = wrappedCode.substring(0, wrappedCode.indexOf(code)).split('\n').length - 1;
      expect(headerLineCount).toBe(actualHeaderLines);
    });

    it("should handle empty input gracefully", () => {
      const code = "";
      const { wrappedCode, headerLineCount } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("precision highp float;");
      expect(wrappedCode).toContain("out vec4 fragColor;");
      expect(wrappedCode).toContain("#define HW_PERFORMANCE 1");
      expect(wrappedCode).toContain("void main() {");
      expect(wrappedCode).toContain("mainImage(fragColor, gl_FragCoord.xy);");
      expect(headerLineCount).toBeGreaterThan(0);
    });

    it("should handle whitespace-only input", () => {
      const code = "   \n  \t  \n   ";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("precision highp float;");
      expect(wrappedCode).toContain("void main() {");
      expect(wrappedCode).toContain("mainImage(fragColor, gl_FragCoord.xy);");
    });

    it("should handle complex shader with multiple functions and uniforms", () => {
      const code = `
        uniform float customUniform;
        #define PI 3.14159
        
        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 uv = fragCoord.xy / iResolution.xy;
          vec3 color = hsv2rgb(vec3(iTime * 0.1, 1.0, 1.0));
          fragColor = vec4(color, 1.0);
        }
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // Verify all parts are present and in correct order
      expect(wrappedCode).toContain("precision highp float;");
      expect(wrappedCode).toContain("uniform float customUniform;");
      expect(wrappedCode).toContain("#define PI 3.14159");
      expect(wrappedCode).toContain("vec3 hsv2rgb(vec3 c)");
      expect(wrappedCode).toContain("void mainImage(out vec4 fragColor, in vec2 fragCoord)");
      expect(wrappedCode).toContain("void main() {");
      expect(wrappedCode).toContain("mainImage(fragColor, gl_FragCoord.xy);");
      
      // Verify standard uniforms are still injected
      expect(wrappedCode).toContain("uniform vec3 iResolution;");
      expect(wrappedCode).toContain("uniform float iTime;");
    });

    it("should handle shader with comments", () => {
      const code = `
        // This is a comment
        /* Multi-line
           comment */
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          // Line comment inside function
          fragColor = vec4(1.0); /* End of line comment */
        }
      `;
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedCode).toContain("// This is a comment");
      expect(wrappedCode).toContain("/* Multi-line");
      expect(wrappedCode).toContain("comment */");
      expect(wrappedCode).toContain("// Line comment inside function");
      expect(wrappedCode).toContain("/* End of line comment */");
    });

    it("should validate exact output format for minimal shader", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code);

      // Remove extra whitespace for comparison but keep structure
      const normalized = wrappedCode.replace(/\s+/g, ' ').trim();
      
      // Verify the exact sequence of key elements with proper spacing
      expect(normalized).toMatch(/precision highp float;\s*out vec4 fragColor;\s*#define HW_PERFORMANCE 1\s*uniform vec3 iResolution;\s*uniform float iTime;\s*uniform float iTimeDelta;\s*uniform float iFrameRate;\s*uniform sampler2D iChannel0;\s*uniform sampler2D iChannel1;\s*uniform sampler2D iChannel2;\s*uniform sampler2D iChannel3;\s*uniform vec4 iMouse;\s*uniform int iFrame;\s*uniform vec4 iDate;\s*void mainImage\(out vec4 fragColor, in vec2 fragCoord\) \{\}\s*void main\(\) \{\s*mainImage\(fragColor, gl_FragCoord\.xy\);\s*\}/);
    });

    it("should prepend common code to shader when provided", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }";
      const commonCode = "vec3 helperFunction() { return vec3(0.5); }\n#define COMMON_CONST 42.0\n";
      const { wrappedCode } = shaderCompiler.wrapShaderToyCode(code, commonCode);

      // Common code should appear after standard uniforms but before user code
      const commonIndex = wrappedCode.indexOf("vec3 helperFunction()");
      const mainImageIndex = wrappedCode.indexOf("void mainImage");

      expect(commonIndex).toBeGreaterThan(wrappedCode.indexOf("uniform vec4 iDate;"));
      expect(commonIndex).toBeLessThan(mainImageIndex);
      expect(wrappedCode).toContain("vec3 helperFunction() { return vec3(0.5); }");
      expect(wrappedCode).toContain("#define COMMON_CONST 42.0");
    });

    it("should handle empty common code gracefully", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode: wrappedWithEmpty } = shaderCompiler.wrapShaderToyCode(code, "");
      const { wrappedCode: wrappedWithout } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedWithEmpty).toBe(wrappedWithout);
    });

    it("should handle undefined common code gracefully", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const { wrappedCode: wrappedWithUndefined } = shaderCompiler.wrapShaderToyCode(code, undefined);
      const { wrappedCode: wrappedWithout } = shaderCompiler.wrapShaderToyCode(code);

      expect(wrappedWithUndefined).toBe(wrappedWithout);
    });

    it("should correctly calculate header line count with common code", () => {
      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const commonCode = "vec3 helperFunction() { return vec3(0.5); }\n#define COMMON_CONST 42.0\n";
      const { headerLineCount } = shaderCompiler.wrapShaderToyCode(code, commonCode);

      // Count lines in the header (everything before user code)
      const lines = commonCode.trim().split('\n');
      const expectedAdditionalLines = lines.length;
      const baseHeaderLines = 16; // Standard uniforms + precision + out + define + 1 new line separator

      expect(headerLineCount).toBe(baseHeaderLines + expectedAdditionalLines);
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

    it("should validate complete vertex and fragment shader structure", () => {
      const capturedShaders: { vs: string; fs: string }[] = [];
      (mockRenderer.CreateShader as any).mockImplementation((vs: string, fs: string) => {
        capturedShaders.push({ vs, fs });
        return createMockShader();
      });

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.5, 0.3, 0.8, 1.0); }";
      shaderCompiler.compileShader(code);

      expect(capturedShaders).toHaveLength(1);
      const { vs, fs } = capturedShaders[0];

      // Validate vertex shader structure
      expect(vs).toBe("in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }");

      // Validate complete fragment shader structure
      const expectedFragmentElements = [
        "precision highp float;",
        "out vec4 fragColor;",
        "#define HW_PERFORMANCE 1",
        "uniform vec3 iResolution;",
        "uniform float iTime;",
        "uniform float iTimeDelta;",
        "uniform float iFrameRate;",
        "uniform sampler2D iChannel0;",
        "uniform sampler2D iChannel1;",
        "uniform sampler2D iChannel2;",
        "uniform sampler2D iChannel3;",
        "uniform vec4 iMouse;",
        "uniform int iFrame;",
        "uniform vec4 iDate;",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.5, 0.3, 0.8, 1.0); }",
        "void main() {",
        " mainImage(fragColor, gl_FragCoord.xy);",
        "}"
      ];

      expectedFragmentElements.forEach(element => {
        expect(fs).toContain(element);
      });
    });

    it("should handle null shader creation from renderer", () => {
      (mockRenderer.CreateShader as any).mockReturnValue(null);

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const result = shaderCompiler.compileShader(code);

      expect(result).toBeNull();
      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);
    });

    it("should validate shader creation with complex input", () => {
      let capturedFragmentShader = "";
      (mockRenderer.CreateShader as any).mockImplementation((vs: string, fs: string) => {
        capturedFragmentShader = fs;
        return createMockShader();
      });

      const complexCode = `
        #define COMPLEX_MACRO(x) (x * 2.0 + sin(iTime))
        uniform float userUniform;
        
        vec3 complexFunction(vec3 input) {
          return normalize(input + vec3(sin(iTime), cos(iTime), 0.0));
        }
        
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 uv = fragCoord / iResolution.xy;
          vec3 color = complexFunction(vec3(uv, iTime * 0.1));
          fragColor = vec4(color * COMPLEX_MACRO(userUniform), 1.0);
        }
      `;

      shaderCompiler.compileShader(complexCode);

      // Verify all elements are present in the final shader
      expect(capturedFragmentShader).toContain("#define COMPLEX_MACRO(x) (x * 2.0 + sin(iTime))");
      expect(capturedFragmentShader).toContain("uniform float userUniform;");
      expect(capturedFragmentShader).toContain("vec3 complexFunction(vec3 input)");
      expect(capturedFragmentShader).toContain("void mainImage(out vec4 fragColor, in vec2 fragCoord)");
      expect(capturedFragmentShader).toContain("precision highp float;");
      expect(capturedFragmentShader).toContain("uniform vec3 iResolution;");
      expect(capturedFragmentShader).toContain("uniform float iTime;");
      expect(capturedFragmentShader).toContain("void main() {");
      expect(capturedFragmentShader).toContain("mainImage(fragColor, gl_FragCoord.xy);");
    });

    it("should handle empty shader code input", () => {
      const mockShader = createMockShader();
      (mockRenderer.CreateShader as any).mockReturnValue(mockShader);

      const code = "";
      const result = shaderCompiler.compileShader(code);

      expect(result).toBe(mockShader);
      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);
      
      // Verify the wrapped code was still generated properly
      const [vs, fs] = (mockRenderer.CreateShader as any).mock.calls[0];
      expect(vs).toContain("in vec2 position;");
      expect(fs).toContain("precision highp float;");
      expect(fs).toContain("void main() {");
    });

    it("should validate exact shader parameters passed to renderer", () => {
      const mockShader = createMockShader();
      let capturedVs = "";
      let capturedFs = "";
      (mockRenderer.CreateShader as any).mockImplementation((vs: string, fs: string) => {
        capturedVs = vs;
        capturedFs = fs;
        return mockShader;
      });

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const result = shaderCompiler.compileShader(code);

      expect(result).toBe(mockShader);
      expect(mockRenderer.CreateShader).toHaveBeenCalledWith(
        "in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }",
        expect.stringContaining("precision highp float;")
      );
      
      // Verify exact vertex shader format
      expect(capturedVs).toBe("in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }");
      
      // Verify fragment shader has all required components in right order
      expect(capturedFs).toMatch(/precision highp float;[\s\S]*out vec4 fragColor;[\s\S]*#define HW_PERFORMANCE 1[\s\S]*uniform vec3 iResolution;[\s\S]*void main\(\) \{[\s\S]*mainImage\(fragColor, gl_FragCoord\.xy\);[\s\S]*\}/);
    });

    it("should pass common code to wrapShaderToyCode when compiling", () => {
      const mockShader = createMockShader();
      (mockRenderer.CreateShader as any).mockReturnValue(mockShader);

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const commonCode = "vec3 helper() { return vec3(1.0); }";
      const result = shaderCompiler.compileShader(code, commonCode);

      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);
      const [vs, fs] = (mockRenderer.CreateShader as any).mock.calls[0];
      expect(fs).toContain("vec3 helper() { return vec3(1.0); }");
      expect(result).toBe(mockShader);
    });

    it("should handle undefined common code in compileShader", () => {
      const mockShader = createMockShader();
      (mockRenderer.CreateShader as any).mockReturnValue(mockShader);

      const code = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {}";
      const result = shaderCompiler.compileShader(code, undefined);

      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockShader);
    });

    it("should ensure newline separation between common buffer and main shader to fix #define concatenation bug", () => {
      const mockShader = createMockShader();
      (mockRenderer.CreateShader as any).mockReturnValue(mockShader);

      // Common buffer that ends without newline
      const commonCode = "vec3 commonHelper() { return vec3(1.0); }"; // No trailing newline
      // Main shader that starts with #define
      const code = "#define MY_DEFINE 1.0\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  fragColor = vec4(MY_DEFINE);\n}";

      const result = shaderCompiler.compileShader(code, commonCode);

      expect(result).toBe(mockShader);
      expect(mockRenderer.CreateShader).toHaveBeenCalledTimes(1);

      const [vs, fs] = (mockRenderer.CreateShader as any).mock.calls[0];

      // Verify that common code and #define are properly separated
      expect(fs).toContain("vec3 commonHelper() { return vec3(1.0); }\n#define MY_DEFINE 1.0");
      // Ensure they are not concatenated without newline
      expect(fs).not.toContain("}#define");
    });
   });
 });

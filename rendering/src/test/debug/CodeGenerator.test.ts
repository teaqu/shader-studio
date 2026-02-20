import { describe, expect, it } from "vitest";
import { CodeGenerator } from "../../debug/CodeGenerator";
import type { FunctionInfo, VarInfo } from "../../debug/GlslParser";

describe("CodeGenerator", () => {
  describe("generateReturnStatementForVar", () => {
    it("should visualize float as grayscale", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d");
      expect(result).toContain("vec4(vec3(d), 1.0)");
    });

    it("should visualize vec2 as RG channels", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec2", "uv");
      expect(result).toContain("vec4(uv, 0.0, 1.0)");
    });

    it("should visualize vec3 as RGB", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec3", "col");
      expect(result).toContain("vec4(col, 1.0)");
    });

    it("should pass vec4 through directly", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec4", "color");
      expect(result).toContain("fragColor = color;");
    });

    it("should handle mat types", () => {
      expect(CodeGenerator.generateReturnStatementForVar("mat2", "m")).toContain("m[0]");
      expect(CodeGenerator.generateReturnStatementForVar("mat3", "m")).toContain("m[0]");
      expect(CodeGenerator.generateReturnStatementForVar("mat4", "m")).toContain("m[0]");
    });

    it("should return magenta for unknown types", () => {
      const result = CodeGenerator.generateReturnStatementForVar("sampler2D", "tex");
      expect(result).toContain("1.0, 0.0, 1.0, 1.0");
    });
  });

  describe("removeControlFlowKeywords", () => {
    it("should strip if/else statements after mainImageStart", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  if (uv.x > 0.5) {",
        "    uv.x = 1.0;",
        "  }",
      ];
      const result = CodeGenerator.removeControlFlowKeywords(lines, 0);
      expect(result).toContain(lines[0]);
      expect(result).toContain(lines[1]);
      expect(result).not.toContain(lines[2]); // if removed
      expect(result).toContain(lines[3]); // body kept
      // Closing brace on last line is kept (only stripped when not the final line)
      expect(result).toContain(lines[4]);
    });

    it("should extract for-loop initialization", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  for (int i = 0; i < 10; i++) {",
        "    float x = 1.0;",
      ];
      const result = CodeGenerator.removeControlFlowKeywords(lines, 0);
      expect(result[1]).toContain("int i = 0;");
      expect(result[1]).toContain("Loop init");
    });

    it("should preserve lines before mainImageStart", () => {
      const lines = [
        "if (true) {",  // Before mainImage — should be kept
        "  float x = 1.0;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  if (false) {",  // After mainImage — should be stripped
        "    float y = 2.0;",
      ];
      const result = CodeGenerator.removeControlFlowKeywords(lines, 3);
      expect(result).toContain(lines[0]); // kept (before mainImage)
      expect(result).not.toContain(lines[4]); // stripped (after mainImage)
    });
  });

  describe("generateDefaultParameters", () => {
    it("should generate uv for vec2 parameters", () => {
      const lines = ["float sdf(vec2 p) {"];
      const functionInfo: FunctionInfo = { name: "sdf", start: 0, end: 2 };
      const result = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      expect(result.args).toBe("uv");
      expect(result.setup[0]).toContain("vec2 uv = fragCoord / iResolution.xy");
    });

    it("should generate defaults for multiple parameter types", () => {
      const lines = ["float fn(vec2 p, float r, vec3 c) {"];
      const functionInfo: FunctionInfo = { name: "fn", start: 0, end: 2 };
      const result = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      expect(result.args).toBe("uv, 0.5, vec3(0.5)");
    });

    it("should return empty for no-param functions", () => {
      const lines = ["float fn() {"];
      const functionInfo: FunctionInfo = { name: "fn", start: 0, end: 2 };
      const result = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      expect(result.args).toBe("");
      expect(result.setup).toEqual([]);
    });
  });

  describe("wrapOneLinerForDebugging", () => {
    it("should wrap a one-liner in a mainImage", () => {
      const varInfo: VarInfo = { name: "col", type: "vec3" };
      const result = CodeGenerator.wrapOneLinerForDebugging("  vec3 col = vec3(1.0);", varInfo);
      expect(result).toContain("void mainImage(out vec4 fragColor, in vec2 fragCoord)");
      expect(result).toContain("vec3 col = vec3(1.0);");
      expect(result).toContain("fragColor = vec4(col, 1.0)");
    });
  });

  describe("wrapFunctionForDebugging", () => {
    it("should create a wrapper mainImage that calls the function", () => {
      const lines = [
        "float sdf(vec2 p) {",
        "  float d = length(p) - 0.5;",
        "  return d;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  float d = sdf(uv);",
        "  fragColor = vec4(vec3(d), 1.0);",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "sdf", start: 0, end: 3 };
      const varInfo: VarInfo = { name: "d", type: "float" };
      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 1, varInfo);

      expect(result).toContain("float sdf(vec2 p)");
      expect(result).toContain("float d = length(p) - 0.5;");
      expect(result).toContain("return d;");
      expect(result).toContain("void mainImage(out vec4 fragColor, in vec2 fragCoord)");
      // Should call sdf with default params
      expect(result).toContain("sdf(uv)");
    });
  });

  describe("generateFunctionCall", () => {
    it("should always use default parameters based on function signature", () => {
      const lines = [
        "float sdf(vec2 p) {",
        "  return length(p);",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  float d = sdf(uv);",
        "  fragColor = vec4(d);",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "sdf", start: 0, end: 2 };
      const varInfo: VarInfo = { name: "d", type: "float" };
      const result = CodeGenerator.generateFunctionCall(lines, "sdf", functionInfo, varInfo);
      expect(result).toContain("sdf(uv)");
      expect(result).toContain("vec2 uv = fragCoord / iResolution.xy");
    });
  });
});

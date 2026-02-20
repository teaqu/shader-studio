import { describe, expect, it } from "vitest";
import { CodeGenerator } from "../CodeGenerator";
import type { FunctionInfo, VarInfo } from "../GlslParser";

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

  describe("closeOpenBraces", () => {
    it("should append closing braces for unmatched opens after functionStart", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  if (uv.x > 0.5) {",
        "    uv.x = 1.0;",
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 0);
      // Original lines preserved
      expect(result[0]).toBe(lines[0]);
      expect(result[1]).toBe(lines[1]);
      expect(result[2]).toBe(lines[2]);
      // Two closing braces appended (one for if, one for mainImage)
      expect(result[3]).toBe('}');
      expect(result[4]).toBe('}');
      expect(result.length).toBe(5);
    });

    it("should handle nested braces", () => {
      const lines = [
        "void fn() {",
        "  if (true) {",
        "    for (int i = 0; i < 10; i++) {",
        "      float x = 1.0;",
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 0);
      // 3 unmatched opens: fn, if, for
      expect(result.length).toBe(7);
      expect(result[4]).toBe('}');
      expect(result[5]).toBe('}');
      expect(result[6]).toBe('}');
    });

    it("should not count braces before functionStart", () => {
      const lines = [
        "float helper() {",
        "  return 1.0;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  float x = 1.0;",
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 3);
      // Only 1 unmatched open (mainImage), helper is balanced before functionStart
      expect(result.length).toBe(6);
      expect(result[5]).toBe('}');
    });

    it("should not append anything when braces are balanced", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  float x = 1.0;",
        "}",
      ];
      const result = CodeGenerator.closeOpenBraces(lines, 0);
      expect(result.length).toBe(3);
    });
  });

  describe("capLoopIterations", () => {
    it("should leave loops unmodified when map is empty", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  for (int i = 0; i < 10; i++) {",
        "    float x = 1.0;",
        "  }",
        "}",
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map());
      expect(result).toEqual(lines);
    });

    it("should inject counter and break for a for loop", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  for (int i = 0; i < 10; i++) {",
        "    float x = 1.0;",
        "  }",
        "}",
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 5]]));
      expect(result).toContain("  int _dbgIter0 = 0;");
      expect(result).toContain("    if (++_dbgIter0 > 5) break;");
    });

    it("should inject counter and break for a while loop", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  while (x > 0.0) {",
        "    x -= 0.1;",
        "  }",
        "}",
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 100]]));
      expect(result).toContain("  int _dbgIter0 = 0;");
      expect(result).toContain("    if (++_dbgIter0 > 100) break;");
    });

    it("should handle nested loops with unique counters", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  for (int i = 0; i < 10; i++) {",
        "    for (int j = 0; j < 5; j++) {",
        "      float x = 1.0;",
        "    }",
        "  }",
        "}",
      ];
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[0, 10], [1, 5]]));
      expect(result).toContain("  int _dbgIter0 = 0;");
      expect(result).toContain("    if (++_dbgIter0 > 10) break;");
      expect(result).toContain("    int _dbgIter1 = 0;");
      expect(result).toContain("      if (++_dbgIter1 > 5) break;");
    });

    it("should only cap loops in the map", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  for (int i = 0; i < 10; i++) {",
        "    float x = 1.0;",
        "  }",
        "  for (int j = 0; j < 5; j++) {",
        "    float y = 2.0;",
        "  }",
        "}",
      ];
      // Only cap the second loop (index 1)
      const result = CodeGenerator.capLoopIterations(lines, 0, new Map([[1, 3]]));
      expect(result.join('\n')).not.toContain("_dbgIter0");
      expect(result).toContain("  int _dbgIter1 = 0;");
      expect(result).toContain("    if (++_dbgIter1 > 3) break;");
    });

    it("should not modify loops before functionStart", () => {
      const lines = [
        "for (int i = 0; i < 10; i++) {",
        "  float x = 1.0;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  float y = 2.0;",
        "}",
      ];
      const result = CodeGenerator.capLoopIterations(lines, 3, new Map([[0, 5]]));
      expect(result.join('\n')).not.toContain("_dbgIter");
    });
  });

  describe("insertShadowVariable", () => {
    it("should return unchanged lines when no containing loops", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  float x = 1.0;",
        "}",
      ];
      const varInfo: VarInfo = { name: "x", type: "float" };
      const { lines: result, shadowVarName } = CodeGenerator.insertShadowVariable(lines, 1, varInfo, []);
      expect(shadowVarName).toBeNull();
      expect(result).toEqual(lines);
    });

    it("should insert shadow declaration before outermost loop and assignment after debug line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  for (int i = 0; i < 10; i++) {",
        "    float x = float(i) * 0.1;",
        "    uv.x += x;",
        "  }",
        "}",
      ];
      const varInfo: VarInfo = { name: "x", type: "float" };
      const containingLoops = [{ lineNumber: 2 }];
      const { lines: result, shadowVarName } = CodeGenerator.insertShadowVariable(lines, 3, varInfo, containingLoops);

      expect(shadowVarName).toBe("_dbgShadow");
      const joined = result.join('\n');
      expect(joined).toContain('float _dbgShadow;');
      expect(joined).toContain('_dbgShadow = x;');
      // Shadow declaration should come before the for loop
      const shadowIdx = result.findIndex(l => l.includes('float _dbgShadow;'));
      const forIdx = result.findIndex(l => l.includes('for (int i'));
      expect(shadowIdx).toBeLessThan(forIdx);
    });

    it("should handle nested loops — shadow declared before outermost", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  for (int i = 0; i < 5; i++) {",
        "    for (int j = 0; j < 10; j++) {",
        "      float val = compute(i, j);",
        "      accumulate(val);",
        "    }",
        "    finalize(i);",
        "  }",
        "}",
      ];
      const varInfo: VarInfo = { name: "val", type: "float" };
      // Both loops contain the debug line
      const containingLoops = [{ lineNumber: 1 }, { lineNumber: 2 }];
      const { lines: result, shadowVarName } = CodeGenerator.insertShadowVariable(lines, 3, varInfo, containingLoops);

      expect(shadowVarName).toBe("_dbgShadow");
      // Shadow declaration should be before the outer for loop
      const shadowIdx = result.findIndex(l => l.includes('float _dbgShadow;'));
      const outerForIdx = result.findIndex(l => l.includes('for (int i'));
      expect(shadowIdx).toBeLessThan(outerForIdx);
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

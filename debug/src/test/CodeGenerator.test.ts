import { describe, expect, it } from "vitest";
import { CodeGenerator } from "../CodeGenerator";
import type { FunctionInfo, VarInfo } from "../GlslParser";

describe("CodeGenerator", () => {
  describe("extendForPreprocessorConditionals", () => {
    it("extends truncation to the matching #endif when inside an active branch", () => {
      const lines = [
        "vec2 evalBezier(float t) {",
        "#if 0",
        "  return vec2(0.0);",
        "#else",
        "  vec2 v = vec2(t);",
        "  return v;",
        "#endif",
        "}",
      ];

      const result = CodeGenerator.extendForPreprocessorConditionals(lines, 0, 5);
      expect(result).toBe(6);
    });
  });

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

    it("should apply soft normalization for float", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "soft");
      expect(result).toContain("abs(d)");
      expect(result).toContain("0.5");
      expect(result).toContain("soft normalized");
    });

    it("should apply soft normalization for vec3", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec3", "col", "soft");
      expect(result).toContain("abs(col)");
      expect(result).toContain("vec3(1.0)");
      expect(result).toContain("soft normalized");
    });

    it("should apply abs normalization for float", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "abs");
      expect(result).toContain("abs(d)");
      expect(result).not.toContain("0.5 + 0.5");
      expect(result).toContain("abs normalized");
    });

    it("should apply abs normalization for vec3", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec3", "col", "abs");
      expect(result).toContain("abs(col)");
      expect(result).toContain("abs normalized");
    });

    it("should not apply normalization when mode is off", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "off");
      expect(result).not.toContain("abs");
      expect(result).toContain("grayscale");
    });

    it("should apply step post-processing to raw float", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "off", 0.75);
      expect(result).toContain("vec3(d)"); // raw visualization
      expect(result).toContain("step(vec3(0.7500), fragColor.rgb)"); // step post-process
      expect(result).toContain("step threshold");
    });

    it("should apply step post-processing to raw vec3", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec3", "col", "off", 0.5);
      expect(result).toContain("vec4(col, 1.0)"); // raw visualization
      expect(result).toContain("step(vec3(0.5000), fragColor.rgb)"); // step post-process
    });

    it("should combine step with soft normalization", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "soft", 0.5);
      expect(result).toContain("abs(d)"); // soft normalization
      expect(result).toContain("step(vec3(0.5000), fragColor.rgb)"); // step post-process
    });

    it("should combine step with abs normalization", () => {
      const result = CodeGenerator.generateReturnStatementForVar("vec3", "col", "abs", 0.3);
      expect(result).toContain("abs(col)"); // abs normalization
      expect(result).toContain("step(vec3(0.3000), fragColor.rgb)"); // step post-process
    });

    it("should not apply step when edge is null", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "off", null);
      expect(result).not.toContain("step threshold");
    });

    it("should not apply step by default (no edge parameter)", () => {
      const result = CodeGenerator.generateReturnStatementForVar("float", "d", "off");
      expect(result).not.toContain("step threshold");
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

  describe("wrapFunctionForDebugging", () => {
    it("preserves #endif when truncating inside a preprocessor branch", () => {
      const shader = [
        "vec2 evalBezier( float t, vec2 v0, vec2 v1, vec2 v2, vec2 v3 )",
        "{",
        "#if 0",
        "    vec2 a0=v0+(v1-v0)*t;",
        "    return a0;",
        "#else",
        "    vec2 v21 = 3.0*(v2-v1);",
        "    vec2 v10 = 3.0*(v1-v0);",
        "    vec2 v03 =     (v0-v3);",
        "    return (((v21-v10)-t*(v03+v21))*t+v10)*t+v0;",
        "#endif    ",
        "}",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(0.0);",
        "}",
      ];

      const functionInfo: FunctionInfo = { name: "evalBezier", start: 0, end: 11 };
      const varInfo: VarInfo = { name: "_dbgReturn", type: "vec2" };

      const result = CodeGenerator.wrapFunctionForDebugging(
        shader,
        functionInfo,
        9,
        varInfo,
        [],
        new Map(),
        new Map(),
      );

      expect(result).toContain("#endif");
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

    it("should handle qualified parameters and allocate temps for out/inout params", () => {
      const lines = ["vec3 getPixel(in vec2 coord, float time, out vec3 tmp, inout float gain) {"];
      const functionInfo: FunctionInfo = { name: "getPixel", start: 0, end: 2 };
      const result = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      expect(result.args).toBe("uv, 0.5, _dbgArg2, _dbgArg3");
      expect(result.setup[0]).toContain("vec2 uv = fragCoord / iResolution.xy");
      expect(result.setup).toContain("  vec3 _dbgArg2 = vec3(0.5);");
      expect(result.setup).toContain("  float _dbgArg3 = 0.5;");
    });

    it("should allocate a temp for user-defined parameter types", () => {
      const lines = [
        "vec2 PointArray(int i, CtrlPts ctrlPts) {",
      ];
      const functionInfo: FunctionInfo = { name: "PointArray", start: 0, end: 2 };
      const result = CodeGenerator.generateDefaultParameters(lines, functionInfo);
      expect(result.args).toBe("1, _dbgArg1");
      expect(result.setup).toContain("  CtrlPts _dbgArg1;");
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

  describe("wrapGlobalScopeForDebugging", () => {
    it("should preserve global preprocessor-backed declarations before appending mainImage", () => {
      const lines = [
        "#ifdef COLOUR_SCATTERING",
        "const vec3 sigmaS = vec3(0.5, 1.0, 1.0);",
        "#else",
        "const vec3 sigmaS = vec3(1.0);",
        "#endif",
        "const vec3 sigmaA = vec3(0.0);",
        "const vec3 sigmaE = max(sigmaS + sigmaA, vec3(1e-6));",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(0.0);",
        "}",
      ];
      const varInfo: VarInfo = { name: "sigmaE", type: "vec3" };

      const result = CodeGenerator.wrapGlobalScopeForDebugging(lines, varInfo);

      expect(result).toContain("#ifdef COLOUR_SCATTERING");
      expect(result).toContain("const vec3 sigmaS = vec3(0.5, 1.0, 1.0);");
      expect(result).toContain("const vec3 sigmaE = max(sigmaS + sigmaA, vec3(1e-6));");
      expect(result).toContain("fragColor = vec4(sigmaE, 1.0)");
      expect(result.match(/void mainImage\(out vec4 fragColor, in vec2 fragCoord\)/g)).toHaveLength(1);
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
      expect(result).toContain("_dbg_sdf(uv)");
    });

    it("should call helper functions with qualified parameters", () => {
      const lines = [
        "vec3 getPixel(in vec2 coord, float time) {",
        "  vec3 color = vec3(coord, time);",
        "  return color;",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "getPixel", start: 0, end: 3 };
      const varInfo: VarInfo = { name: "_dbgReturn", type: "vec3" };
      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 2, varInfo);

      expect(result).toContain("vec2 uv = fragCoord / iResolution.xy;");
      expect(result).toContain("vec3 result = _dbg_getPixel(uv, 0.5);");
    });

    it("should pass temp variables for out parameters in helper function calls", () => {
      const lines = [
        "float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {",
        "  p = ori + dir;",
        "  return 1.0;",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "heightMapTracing", start: 0, end: 3 };
      const varInfo: VarInfo = { name: "_dbgReturn", type: "float" };
      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 2, varInfo);

      expect(result).toContain("vec3 _dbgArg2 = vec3(0.5);");
      expect(result).toContain("float result = _dbg_heightMapTracing(vec3(0.5), vec3(0.5), _dbgArg2);");
    });

    it("should not duplicate a helper or mainImage when the helper is declared after mainImage", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  fragColor = vec4(uv, 0.0, 1.0);",
        "}",
        "",
        "float test() {",
        "  return 0.0;",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "test", start: 5, end: 7 };
      const varInfo: VarInfo = { name: "_dbgReturn", type: "float" };

      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 6, varInfo);

      expect(result.match(/void mainImage\(out vec4 fragColor, in vec2 fragCoord\) \{/g)?.length).toBe(1);
      expect(result.match(/float test\(\) \{/g)?.length).toBe(1);
      expect(result.match(/float _dbg_test\(\) \{/g)?.length).toBe(1);
    });

    it("should generate a full default call for helpers with multi-line signatures", () => {
      const lines = [
        "vec2 bezier( vec2 p,",
        "             vec2 v0, vec2 v1, vec2 v2, vec2 v3,",
        "             vec2 wd, float bo )",
        "{",
        "    return wd;",
        "}",
      ];
      const functionInfo = { name: "bezier", start: 0, end: 5 };
      const varInfo = { name: "_dbgReturn", type: "vec2" };

      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 4, varInfo);

      expect(result).toContain("vec2 result = _dbg_bezier(uv, uv, uv, uv, uv, uv, 0.5);");
    });

    it("should capture non-return vars on return lines while stripping earlier returns", () => {
      const lines = [
        "float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {",
        "  if (true) {",
        "    p = ori + dir;",
        "    return 1.0;",
        "  }",
        "  return 2.0;",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "heightMapTracing", start: 0, end: 6 };
      const varInfo: VarInfo = { name: "ori", type: "vec3" };
      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 5, varInfo);

      expect(result).toContain("vec3 _dbgCaptured;");
      expect(result).toContain("_dbgCaptured = ori;");
      expect(result).toContain("// Debug: stripped earlier return");
      expect(result).toContain("heightMapTracing(vec3(0.5), vec3(0.5), _dbgArg2);");
      expect(result).toContain("fragColor = vec4(_dbgCaptured, 1.0)");
    });

    it("should strip earlier returns in multi-return helpers when debugging a later variable", () => {
      const lines = [
        "float clouds(vec3 p, out float cloudHeight, bool sampleNoise) {",
        "  if (p.y < 0.0) {",
        "    return 0.0;",
        "  }",
        "  cloudHeight = p.y;",
        "  float cloud = cloudHeight;",
        "  if (cloud <= 0.0) {",
        "    return 0.0;",
        "  }",
        "  float shape = cloud * 0.5;",
        "  return shape;",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "clouds", start: 0, end: 11 };
      const varInfo: VarInfo = { name: "shape", type: "float" };
      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 9, varInfo);

      expect(result).toContain("// Debug: stripped earlier return");
      expect(result).toContain("float shape = cloud * 0.5;");
      expect(result).toContain("return shape;");
    });

    it("should preserve helper functions defined after the target helper", () => {
      const lines = [
        "float clouds(vec3 p, out float cloudHeight, bool sampleNoise) {",
        "  cloudHeight = saturateLater(p.y);",
        "  return cloudHeight;",
        "}",
        "",
        "float saturateLater(float x) {",
        "  return clamp(x, 0.0, 1.0);",
        "}",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const functionInfo: FunctionInfo = { name: "clouds", start: 0, end: 3 };
      const varInfo: VarInfo = { name: "cloudHeight", type: "float" };
      const result = CodeGenerator.wrapFunctionForDebugging(lines, functionInfo, 1, varInfo);

      expect(result).toContain("float saturateLater(float x) {");
      expect(result).toContain("return clamp(x, 0.0, 1.0);");
      expect(result).toContain("cloudHeight = saturateLater(p.y);");
    });
  });

  describe("applyOutputPostProcessing", () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;

    it("should return null when no post-processing needed", () => {
      const result = CodeGenerator.applyOutputPostProcessing(shader, 'off', null);
      expect(result).toBeNull();
    });

    it("should inject soft normalization before closing brace", () => {
      const result = CodeGenerator.applyOutputPostProcessing(shader, 'soft', null);
      expect(result).not.toBeNull();
      expect(result).toContain('fragColor.rgb = fragColor.rgb / (abs(fragColor.rgb) + vec3(1.0)) * 0.5 + 0.5;');
    });

    it("should inject abs normalization before closing brace", () => {
      const result = CodeGenerator.applyOutputPostProcessing(shader, 'abs', null);
      expect(result).not.toBeNull();
      expect(result).toContain('fragColor.rgb = abs(fragColor.rgb) / (abs(fragColor.rgb) + vec3(1.0));');
    });

    it("should inject step threshold before closing brace", () => {
      const result = CodeGenerator.applyOutputPostProcessing(shader, 'off', 0.5);
      expect(result).not.toBeNull();
      expect(result).toContain('step(vec3(0.5000), fragColor.rgb)');
    });

    it("should combine normalize and step", () => {
      const result = CodeGenerator.applyOutputPostProcessing(shader, 'soft', 0.75);
      expect(result).not.toBeNull();
      expect(result).toContain('fragColor.rgb = fragColor.rgb / (abs(fragColor.rgb)');
      expect(result).toContain('step(vec3(0.7500), fragColor.rgb)');
    });

    it("should return null when no mainImage function found", () => {
      const noMain = `float sdf(vec2 p) { return length(p); }`;
      const result = CodeGenerator.applyOutputPostProcessing(noMain, 'soft', null);
      expect(result).toBeNull();
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

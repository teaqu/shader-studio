import { describe, expect, it } from "vitest";
import { GlslParser } from "../GlslParser";

describe("GlslParser", () => {
  describe("findEnclosingFunction", () => {
    it("should find mainImage when cursor is inside it", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  fragColor = vec4(uv, 0.0, 1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 1);
      expect(result.name).toBe("mainImage");
      expect(result.start).toBe(0);
      expect(result.end).toBe(3);
    });

    it("should find a helper function when cursor is inside it", () => {
      const lines = [
        "float sphere(vec3 p, float r) {",
        "  return length(p) - r;",
        "}",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 1);
      expect(result.name).toBe("sphere");
      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it("should return null name when cursor is outside any function", () => {
      const lines = [
        "uniform vec3 iResolution;",
        "const float PI = 3.14159;",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 1);
      expect(result.name).toBeNull();
    });

    it("should handle brace on next line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord)",
        "{",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 2);
      expect(result.name).toBe("mainImage");
      expect(result.start).toBe(0);
    });

    it("should find mainImage when cursor is on the function declaration line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 0);
      expect(result.name).toBe("mainImage");
      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it("should find mainImage on declaration line when brace is on next line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord)",
        "{",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 0);
      expect(result.name).toBe("mainImage");
      expect(result.start).toBe(0);
      expect(result.end).toBe(3);
    });

    it("should find helper function when cursor is on its closing brace line", () => {
      const lines = [
        "float sphere(vec3 p, float r) {",
        "  return length(p) - r;",
        "}",                              // cursor on this line
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 2);
      expect(result.name).toBe("sphere");
      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it("should find mainImage when cursor is on its closing brace line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",                              // cursor on this line
      ];
      const result = GlslParser.findEnclosingFunction(lines, 2);
      expect(result.name).toBe("mainImage");
      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it("should fall back cleanly for function names ShaderFrog rejects", () => {
      const lines = [
        "vec4 sample(sampler2D tex, vec2 uv) {",
        "  return texture(tex, uv);",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 1);
      expect(result.name).toBe("sample");
      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it("should keep function mapping stable through preprocessor conditionals", () => {
      const lines = [
        "vec2 evalBezier( float t, vec2 v0, vec2 v1, vec2 v2, vec2 v3 )",
        "{",
        "#if 0",
        "    return v0;",
        "#else",
        "    return v3;",
        "#endif",
        "}",
      ];
      const result = GlslParser.findEnclosingFunction(lines, 5);
      expect(result.name).toBe("evalBezier");
      expect(result.start).toBe(0);
      expect(result.end).toBe(7);
    });

    it("should not throw when the cursor line is beyond the source length", () => {
      const lines = [
        "float sdf(vec2 p, float r) {",
        "  return length(p) - r;",
        "}",
      ];

      expect(() => GlslParser.findEnclosingFunction(lines, 8)).not.toThrow();
      expect(GlslParser.findEnclosingFunction(lines, 8)).toEqual({
        name: null,
        start: -1,
        end: -1,
      });
    });
  });

  describe("buildVariableTypeMap", () => {
    it("should detect variable declarations", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  float d = 0.0;",
        "  vec3 col = vec3(0.0);",
        "}",
      ];
      const functionInfo = { name: "mainImage", start: 0, end: 4 };
      const varTypes = GlslParser.buildVariableTypeMap(lines, 3, functionInfo);

      expect(varTypes.get("uv")).toBe("vec2");
      expect(varTypes.get("d")).toBe("float");
      expect(varTypes.get("col")).toBe("vec3");
    });

    it("should include function parameters", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "}",
      ];
      const functionInfo = { name: "mainImage", start: 0, end: 2 };
      const varTypes = GlslParser.buildVariableTypeMap(lines, 1, functionInfo);

      expect(varTypes.get("fragColor")).toBe("vec4");
      expect(varTypes.get("fragCoord")).toBe("vec2");
      expect(varTypes.get("uv")).toBe("vec2");
    });

    it("should only include variables up to the specified line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  float a = 1.0;",
        "  float b = 2.0;",
        "  float c = 3.0;",
        "}",
      ];
      const functionInfo = { name: "mainImage", start: 0, end: 4 };
      const varTypes = GlslParser.buildVariableTypeMap(lines, 1, functionInfo);

      expect(varTypes.get("a")).toBe("float");
      expect(varTypes.has("b")).toBe(false);
      expect(varTypes.has("c")).toBe(false);
    });

    it("should exclude inactive preprocessor branch declarations", () => {
      const lines = [
        "vec2 evalBezier( float t, vec2 v0, vec2 v1, vec2 v2, vec2 v3 )",
        "{",
        "#if 0",
        "    vec2 a0 = v0;",
        "#else",
        "    vec2 v21 = 3.0*(v2-v1);",
        "#endif",
        "    return v21;",
        "}",
      ];
      const functionInfo = GlslParser.findEnclosingFunction(lines, 7);
      const varTypes = GlslParser.buildVariableTypeMap(lines, 7, functionInfo);

      expect(varTypes.get("t")).toBe("float");
      expect(varTypes.get("v21")).toBe("vec2");
      expect(varTypes.has("a0")).toBe(false);
    });

    it("should fall back to legacy parameter discovery when the parser rejects a function", () => {
      const lines = [
        "vec4 sample(sampler2D tex, vec2 uv) {",
        "  return texture(tex, uv);",
        "}",
      ];
      const functionInfo = GlslParser.findEnclosingFunction(lines, 1);
      const varTypes = GlslParser.buildVariableTypeMap(lines, 1, functionInfo);

      expect(varTypes.get("tex")).toBe("sampler2D");
      expect(varTypes.get("uv")).toBe("vec2");
    });
  });

  describe("detectVariableAndType", () => {
    it("should detect a variable declaration", () => {
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("  vec3 col = vec3(1.0);", varTypes);
      expect(result).toEqual({ name: "col", type: "vec3" });
    });

    it("should detect a reassignment using the type map", () => {
      const varTypes = new Map([["uv", "vec2"]]);
      const result = GlslParser.detectVariableAndType("  uv = fragCoord / iResolution.xy;", varTypes);
      expect(result).toEqual({ name: "uv", type: "vec2" });
    });

    it("should detect compound assignments", () => {
      const varTypes = new Map([["uv", "vec2"]]);
      const result = GlslParser.detectVariableAndType("  uv *= 2.0;", varTypes);
      expect(result).toEqual({ name: "uv", type: "vec2" });
    });

    it("should detect member access assignments", () => {
      const varTypes = new Map([["uv", "vec2"]]);
      const result = GlslParser.detectVariableAndType("  uv.x *= aspect;", varTypes);
      expect(result).toEqual({ name: "uv", type: "vec2" });
    });

    it("should detect return statements with function return type", () => {
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("  return length(p) - r;", varTypes, "float");
      expect(result).toEqual({ name: "_dbgReturn", type: "float" });
    });

    it("should return null for unrecognized lines", () => {
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("  // just a comment", varTypes);
      expect(result).toBeNull();
    });

    it("should detect standalone function call returning vec3", () => {
      const lines = [
        "vec3 red() {",
        "    return vec3(1.0, 0.0, 0.0);",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "    red();",
        "}",
      ];
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("    red();", varTypes, undefined, lines);
      expect(result).toEqual({ name: "_dbgCall", type: "vec3" });
    });

    it("should detect standalone function call returning float", () => {
      const lines = [
        "float sdf(vec2 p) {",
        "    return length(p) - 0.5;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "    sdf(uv);",
        "}",
      ];
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("    sdf(uv);", varTypes, undefined, lines);
      expect(result).toEqual({ name: "_dbgCall", type: "float" });
    });

    it("should not detect void function call", () => {
      const lines = [
        "void doNothing() {",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "    doNothing();",
        "}",
      ];
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("    doNothing();", varTypes, undefined, lines);
      expect(result).toBeNull();
    });

    it("should not treat if/for/while as function calls", () => {
      const varTypes = new Map<string, string>();
      const lines = ["void mainImage(out vec4 fragColor, in vec2 fragCoord) {", "    if (true) {", "}"];
      expect(GlslParser.detectVariableAndType("    if (true) {", varTypes, undefined, lines)).toBeNull();
      expect(GlslParser.detectVariableAndType("    for (int i = 0; i < 10; i++) {", varTypes, undefined, lines)).toBeNull();
      expect(GlslParser.detectVariableAndType("    while (true) {", varTypes, undefined, lines)).toBeNull();
    });

    it("should not merge a for-loop header with the next declaration", () => {
      const lines = [
        "vec2 bezier( vec2 p,",
        "             vec2 v0, vec2 v1, vec2 v2, vec2 v3,",
        "             vec2 wd, float bo )",
        "{",
        "    const int num = 10;",
        "    for( int i=1; i<num; i++ )",
        "    {",
        "        float t = float(i)/float(num-1);",
        "    }",
        "}",
      ];
      const varTypes = new Map([
        ["p", "vec2"],
        ["v0", "vec2"],
        ["v1", "vec2"],
        ["v2", "vec2"],
        ["v3", "vec2"],
        ["wd", "vec2"],
        ["bo", "float"],
        ["num", "int"],
        ["i", "int"],
      ]);

      const result = GlslParser.detectVariableAndType(lines[5], varTypes, "vec2", lines, 5);
      expect(result).toBeNull();
    });

    it("should detect return on a function with a multi-line signature", () => {
      const lines = [
        "vec2 bezier( vec2 p,",
        "             vec2 v0, vec2 v1, vec2 v2, vec2 v3,",
        "             vec2 wd, float bo )",
        "{",
        "    return wd;",
        "}",
      ];
      const varTypes = new Map([
        ["wd", "vec2"],
      ]);

      const result = GlslParser.detectVariableAndType(lines[4], varTypes, "vec2", lines, 4);
      expect(result).toEqual({ name: "_dbgReturn", type: "vec2" });
    });

    it("should return null for function call with no lines context", () => {
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType("    red();", varTypes);
      expect(result).toBeNull();
    });

    it("should handle multi-line statements", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec3 col =",
        "    vec3(1.0, 0.0, 0.0);",
        "}",
      ];
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType(lines[2], varTypes, undefined, lines, 2);
      expect(result).toEqual({ name: "col", type: "vec3" });
    });

    it("should ignore returns in inactive preprocessor branches", () => {
      const lines = [
        "float foo() {",
        "#if 0",
        "  return 1.0;",
        "#else",
        "  return 2.0;",
        "#endif",
        "}",
      ];
      const varTypes = new Map<string, string>();
      const result = GlslParser.detectVariableAndType(lines[2], varTypes, "float", lines, 2);
      expect(result).toBeNull();
    });
  });

  describe("findFunctionReturnType", () => {
    it("should find vec3 return type", () => {
      const lines = [
        "vec3 red() {",
        "    return vec3(1.0, 0.0, 0.0);",
        "}",
      ];
      expect(GlslParser.findFunctionReturnType(lines, "red")).toBe("vec3");
    });

    it("should find float return type", () => {
      const lines = [
        "float sdf(vec2 p) {",
        "    return length(p) - 0.5;",
        "}",
      ];
      expect(GlslParser.findFunctionReturnType(lines, "sdf")).toBe("float");
    });

    it("should find void return type", () => {
      const lines = [
        "void doNothing() {",
        "}",
      ];
      expect(GlslParser.findFunctionReturnType(lines, "doNothing")).toBe("void");
    });

    it("should find mat4 return type", () => {
      const lines = ["mat4 identity() {", "    return mat4(1.0);", "}"];
      expect(GlslParser.findFunctionReturnType(lines, "identity")).toBe("mat4");
    });

    it("should find int return type", () => {
      const lines = ["int getIndex(float f) {", "    return int(f);", "}"];
      expect(GlslParser.findFunctionReturnType(lines, "getIndex")).toBe("int");
    });

    it("should find bool return type", () => {
      const lines = ["bool isValid(float f) {", "    return f > 0.0;", "}"];
      expect(GlslParser.findFunctionReturnType(lines, "isValid")).toBe("bool");
    });

    it("should return null for unknown function", () => {
      const lines = [
        "vec3 red() {",
        "    return vec3(1.0, 0.0, 0.0);",
        "}",
      ];
      expect(GlslParser.findFunctionReturnType(lines, "blue")).toBeNull();
    });

    it("should not match a function with a different name that contains the target name", () => {
      const lines = [
        "float redComponent(vec3 c) {",
        "    return c.r;",
        "}",
      ];
      expect(GlslParser.findFunctionReturnType(lines, "red")).toBeNull();
    });

    it("should handle leading whitespace", () => {
      const lines = [
        "    vec3 indented() {",
        "        return vec3(0.0);",
        "    }",
      ];
      expect(GlslParser.findFunctionReturnType(lines, "indented")).toBe("vec3");
    });
  });

  describe("buildVariableLineMap", () => {
    it("should map params to the function signature line", () => {
      const lines = [
        "float foo(vec3 p, float r) {",
        "  return length(p) - r;",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 1);
      const lineMap = GlslParser.buildVariableLineMap(lines, 1, funcInfo);
      expect(lineMap.get('p')).toBe(0);
      expect(lineMap.get('r')).toBe(0);
    });

    it("should map locals to their declaration line", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  float t = iTime;",
        "  vec3 col = vec3(uv, t);",
        "  fragColor = vec4(col, 1.0);",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 4);
      const lineMap = GlslParser.buildVariableLineMap(lines, 4, funcInfo);
      // fragColor has a reassignment on line 4, so it should point there
      expect(lineMap.get('fragColor')).toBe(4);
      expect(lineMap.get('fragCoord')).toBe(0); // param, no reassignment
      expect(lineMap.get('uv')).toBe(1);
      expect(lineMap.get('t')).toBe(2);
      expect(lineMap.get('col')).toBe(3);
    });

    it("should track reassignments as closest occurrence", () => {
      const lines = [
        "float foo(vec3 p, float r) {",
        "  p = abs(p);",
        "  vec3 q = p + vec3(r);",
        "  return length(q);",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 3);
      const varTypes = GlslParser.buildVariableTypeMap(lines, 3, funcInfo);
      const lineMap = GlslParser.buildVariableLineMap(lines, 3, funcInfo, varTypes);
      // p was reassigned on line 1, so it points there not the param
      expect(lineMap.get('p')).toBe(1);
      // r was never reassigned, stays at param line
      expect(lineMap.get('r')).toBe(0);
      expect(lineMap.get('q')).toBe(2);
    });

    it("same line assignment should point to that line", () => {
      const lines = [
        "float foo(vec3 p, float r) {",
        "  p = abs(p);",
        "  return length(p);",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 1);
      const varTypes = GlslParser.buildVariableTypeMap(lines, 1, funcInfo);
      const lineMap = GlslParser.buildVariableLineMap(lines, 1, funcInfo, varTypes);
      // On the p = abs(p) line itself, p should point to line 1
      expect(lineMap.get('p')).toBe(1);
    });

    it("should track member access assignments", () => {
      const lines = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  uv.y += 0.5;",
        "  fragColor = vec4(uv, 0.0, 1.0);",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 3);
      const varTypes = GlslParser.buildVariableTypeMap(lines, 3, funcInfo);
      const lineMap = GlslParser.buildVariableLineMap(lines, 3, funcInfo, varTypes);
      // uv was modified on line 2 via member access
      expect(lineMap.get('uv')).toBe(2);
      expect(lineMap.get('fragColor')).toBe(3);
    });

    it("should not include variables from other functions", () => {
      const lines = [
        "float helper(vec3 p) {",
        "  float d = length(p);",
        "  return d;",
        "}",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  vec2 uv = fragCoord / iResolution.xy;",
        "  fragColor = vec4(uv, 0.0, 1.0);",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 7);
      const lineMap = GlslParser.buildVariableLineMap(lines, 7, funcInfo);
      expect(lineMap.has('p')).toBe(false);
      expect(lineMap.has('d')).toBe(false);
      expect(lineMap.get('uv')).toBe(6);
    });

    it("should preserve parameter line mapping in legacy fallback mode", () => {
      const lines = [
        "vec4 sample(sampler2D tex, vec2 uv) {",
        "  return texture(tex, uv);",
        "}",
      ];
      const funcInfo = GlslParser.findEnclosingFunction(lines, 1);
      const varTypes = GlslParser.buildVariableTypeMap(lines, 1, funcInfo);
      const lineMap = GlslParser.buildVariableLineMap(lines, 1, funcInfo, varTypes);

      expect(lineMap.get('tex')).toBe(0);
      expect(lineMap.get('uv')).toBe(0);
    });
  });

});

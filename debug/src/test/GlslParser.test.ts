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

});

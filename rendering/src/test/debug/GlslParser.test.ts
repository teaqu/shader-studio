import { describe, expect, it } from "vitest";
import { GlslParser } from "../../debug/GlslParser";

describe("GlslParser", () => {
  describe("findMainImageStart", () => {
    it("should find mainImage on the correct line", () => {
      const lines = [
        "uniform vec3 iResolution;",
        "",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      expect(GlslParser.findMainImageStart(lines)).toBe(2);
    });

    it("should return -1 when no mainImage exists", () => {
      const lines = ["float foo() {", "  return 1.0;", "}"];
      expect(GlslParser.findMainImageStart(lines)).toBe(-1);
    });
  });

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

  describe("findFunctionCall", () => {
    it("should find a function call inside mainImage", () => {
      const lines = [
        "float sphere(vec3 p, float r) {",
        "  return length(p) - r;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  float d = sphere(vec3(0.0), 1.0);",
        "  fragColor = vec4(d);",
        "}",
      ];
      const result = GlslParser.findFunctionCall(lines, "sphere");
      expect(result).not.toBeNull();
      // Regex uses [^)]* so nested parens stop at first ) — captures "vec3(0.0"
      expect(result!.params).toBe("vec3(0.0");
      expect(result!.lineIndex).toBe(4);
    });

    it("should not match function declarations", () => {
      const lines = [
        "float sphere(vec3 p, float r) {",
        "  return length(p) - r;",
        "}",
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
        "  fragColor = vec4(1.0);",
        "}",
      ];
      const result = GlslParser.findFunctionCall(lines, "sphere");
      expect(result).toBeNull();
    });

    it("should return null when no mainImage exists", () => {
      const lines = [
        "float foo(float x) {",
        "  return x * 2.0;",
        "}",
      ];
      const result = GlslParser.findFunctionCall(lines, "foo");
      expect(result).toBeNull();
    });
  });
});

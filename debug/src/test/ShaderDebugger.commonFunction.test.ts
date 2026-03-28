import { describe, expect, it } from "vitest";
import { ShaderDebugger } from "../ShaderDebugger";

describe("ShaderDebugger common helper functions", () => {
  it("does not throw when asked to debug an out-of-range line in common code", () => {
    const commonCode = [
      "float sdf(vec2 p, float r) {",
      "  return length(p) - r;",
      "}",
    ].join("\n");

    expect(() =>
      ShaderDebugger.modifyShaderForDebugging(commonCode, 8, "  return length(p) - r;"),
    ).not.toThrow();

    expect(
      ShaderDebugger.modifyShaderForDebugging(commonCode, 8, "  return length(p) - r;"),
    ).toBeNull();
  });

  it("uses the actual common source line for global one-liner debugging, not stale cursor payload text", () => {
    const commonCode = [
      "// Common functions shared across all passes",
      "vec3 red = vec3(1.0, 0.0, 0.0);",
      "",
      "vec3 green = vec3(0.0, 1.0, 0.0);",
    ].join("\n");

    const result = ShaderDebugger.modifyShaderForDebugging(
      commonCode,
      1,
      "vec3 stale = vec3(0.4);",
    );

    expect(result).not.toBeNull();
    expect(result).toContain("vec3 red = vec3(1.0, 0.0, 0.0);");
    expect(result).toContain("fragColor = vec4(red, 1.0)");
    expect(result).not.toContain("vec3 stale = vec3(0.4);");
  });

  it("preserves earlier global dependencies when debugging a later global declaration", () => {
    const commonCode = [
      "#ifdef COLOUR_SCATTERING",
      "const vec3 sigmaS = vec3(0.5, 1.0, 1.0);",
      "#else",
      "const vec3 sigmaS = vec3(1.0);",
      "#endif",
      "const vec3 sigmaA = vec3(0.0);",
      "const vec3 sigmaE = max(sigmaS + sigmaA, vec3(1e-6));",
    ].join("\n");

    const result = ShaderDebugger.modifyShaderForDebugging(
      commonCode,
      6,
      "const vec3 sigmaE = max(sigmaS + sigmaA, vec3(1e-6));",
    );

    expect(result).not.toBeNull();
    expect(result).toContain("#ifdef COLOUR_SCATTERING");
    expect(result).toContain("const vec3 sigmaS = vec3(0.5, 1.0, 1.0);");
    expect(result).toContain("const vec3 sigmaE = max(sigmaS + sigmaA, vec3(1e-6));");
    expect(result).toContain("fragColor = vec4(sigmaE, 1.0)");
  });

  it("does not climb from a global comment line into a neighboring function body", () => {
    const commonCode = [
      "float globalA = 1.0;",
      "",
      "float helper(float value) {",
      "  float localValue = value * 2.0;",
      "  return localValue;",
      "}",
      "",
      "// top-level note",
    ].join("\n");

    const result = ShaderDebugger.modifyShaderForDebugging(
      commonCode,
      6,
      "// top-level note",
    );

    expect(result).not.toBeNull();
    expect(result).toContain("float globalA = 1.0;");
    expect(result).toContain("fragColor = vec4(vec3(globalA), 1.0)");
    expect(result).not.toContain("fragColor = vec4(vec3(localValue), 1.0)");
  });
});

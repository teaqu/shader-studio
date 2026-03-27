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
});

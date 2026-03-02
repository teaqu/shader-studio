import { describe, expect, it } from "vitest";
import { CodeGenerator } from "../CodeGenerator";

describe("CodeGenerator.generateCaptureOutputForVar", () => {
  it("should output float in R channel", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("float", "d");
    expect(result).toContain("fragColor = vec4(d, 0.0, 0.0, 0.0);");
  });

  it("should output vec2 in RG channels", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("vec2", "uv");
    expect(result).toContain("fragColor = vec4(uv, 0.0, 0.0);");
  });

  it("should output vec3 in RGB channels", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("vec3", "col");
    expect(result).toContain("fragColor = vec4(col, 0.0);");
  });

  it("should output vec4 directly", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("vec4", "color");
    expect(result).toContain("fragColor = color;");
  });

  it("should cast int to float in R channel", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("int", "n");
    expect(result).toContain("fragColor = vec4(float(n), 0.0, 0.0, 0.0);");
  });

  it("should convert bool to 0/1 in R channel", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("bool", "flag");
    expect(result).toContain("fragColor = vec4(flag ? 1.0 : 0.0, 0.0, 0.0, 0.0);");
  });

  it("should return safe zero fallback for unknown type", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("sampler2D", "tex");
    expect(result).toContain("fragColor = vec4(0.0);");
  });

  it("should pack mat2 columns into RGBA", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("mat2", "m");
    expect(result).toContain("fragColor = vec4(m[0], m[1]);");
  });

  it("should return safe zero fallback for mat4", () => {
    const result = CodeGenerator.generateCaptureOutputForVar("mat4", "m");
    expect(result).toContain("fragColor = vec4(0.0);");
  });
});

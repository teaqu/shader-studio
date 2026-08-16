import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ShaderDebugger } from "../ShaderDebugger";
import { VariableCaptureBuilder } from "../VariableCaptureBuilder";

const shaderPath = new URL(
  "../../../../rendering/src/test/fixtures/shader-corpus/foundation/debugging/passes/history_glsl.glsl",
  import.meta.url,
);
const shader = readFileSync(shaderPath, "utf8");
const lines = shader.split("\n");

describe("nested block debugger regressions", () => {
  it("keeps an inline declaration selected inside an if block in scope", () => {
    const output = ShaderDebugger.modifyShaderForLineDebug(shader, 39, lines[39]);

    expect(output).not.toBeNull();
    expect(output).toMatch(/float _dbgShadow\w*;[\s\S]*_dbgShadow\w* = mouseInk;/);
  });

  it("shadows a block-local variable for capture output", () => {
    const variables = VariableCaptureBuilder.getAllInScopeVariables(shader, 39);
    const output = VariableCaptureBuilder.generateMultiCaptureShader(
      shader,
      39,
      variables,
      new Map(),
      new Map(),
      true,
      1,
      1,
    );

    expect(output).not.toBeNull();
    expect(output).toMatch(/float _dbgShadow\d+;[\s\S]*_dbgShadow\d+ = mouseInk;/);
  });

  it("does not mistake an assignment inside a closed block for a declaration", () => {
    const variables = VariableCaptureBuilder.getAllInScopeVariables(shader, 43);
    const output = VariableCaptureBuilder.generateMultiCaptureShader(
      shader,
      43,
      variables,
      new Map(),
      new Map(),
      true,
      1,
      1,
    );

    expect(output).not.toBeNull();
    expect(output).not.toContain("_dbgShadow");
    expect(output).toContain("fragColor = vec4(inkColor, 0.0)");
  });

  it("hoists an else-local value before the complete if/else chain", () => {
    const elseShader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  if (fragCoord.x > 1.0) {
    fragColor = vec4(0.0);
  } else {
    float branchValue = fragCoord.y;
  }
}`;
    const output = ShaderDebugger.modifyShaderForLineDebug(
      elseShader,
      4,
      "    float branchValue = fragCoord.y;",
    );

    expect(output).not.toBeNull();
    expect(output!.indexOf("float _dbgShadow;")).toBeLessThan(output!.indexOf("if (fragCoord.x"));
    expect(output).toContain("_dbgShadow = branchValue;");

    const variables = VariableCaptureBuilder.getAllInScopeVariables(elseShader, 4);
    const capture = VariableCaptureBuilder.generateMultiCaptureShader(
      elseShader,
      4,
      variables,
      new Map(),
      new Map(),
      true,
      1,
      1,
    );
    expect(capture).not.toBeNull();
    expect(capture!.indexOf("float _dbgShadow")).toBeLessThan(capture!.indexOf("if (fragCoord.x"));
    expect(capture).toMatch(/_dbgShadow\d+ = branchValue;/);
  });
});

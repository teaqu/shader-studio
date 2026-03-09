import { describe, expect, it } from "vitest";
import { VariableCaptureBuilder } from "../VariableCaptureBuilder";

const simpleMainImage = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float d = length(uv - 0.5);
  vec3 col = vec3(d);
  fragColor = vec4(col, 1.0);
}`;

const withMat2 = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  mat2 m = mat2(1.0, 0.0, 0.0, 1.0);
  float d = length(uv);
  fragColor = vec4(d);
}`;

const withMat4 = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  mat4 m = mat4(1.0);
  float d = length(uv);
  fragColor = vec4(d);
}`;

const withLoop = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float acc = 0.0;
  for (int i = 0; i < 10; i++) {
    float val = float(i) * 0.1;
    acc += val;
  }
  fragColor = vec4(acc);
}`;

describe("VariableCaptureBuilder.getAllInScopeVariables", () => {
  it("should return all capturable vars in mainImage", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(simpleMainImage, 3);
    const names = vars.map(v => v.varName);
    expect(names).toContain("uv");
    expect(names).toContain("d");
    expect(names).toContain("col");
  });

  it("should include mat2 (capturable — fits in RGBA)", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withMat2, 3);
    const names = vars.map(v => v.varName);
    expect(names).toContain("m");
    const m = vars.find(v => v.varName === "m");
    expect(m?.varType).toBe("mat2");
  });

  it("should filter out mat4 (not capturable)", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withMat4, 3);
    const names = vars.map(v => v.varName);
    expect(names).not.toContain("m");
    expect(names).toContain("uv");
    expect(names).toContain("d");
  });

  it("should use last line of mainImage for debugLine=-1 (whole-shader mode)", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(simpleMainImage, -1);
    expect(vars.length).toBeGreaterThan(0);
    const names = vars.map(v => v.varName);
    expect(names).toContain("uv");
    expect(names).toContain("d");
    expect(names).toContain("col");
  });

  it("should cap at 15 variables", () => {
    // Build a shader with 20 float declarations
    const decls = Array.from({ length: 20 }, (_, i) => `  float v${i} = float(${i});`).join('\n');
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n${decls}\n  fragColor = vec4(v0);\n}`;
    const vars = VariableCaptureBuilder.getAllInScopeVariables(shader, 20);
    expect(vars.length).toBeLessThanOrEqual(15);
  });
});

describe("VariableCaptureBuilder.generateCaptureShader", () => {
  it("should generate shader that outputs float var in R channel", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "d", "float", new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain("fragColor = vec4(d, 0.0, 0.0, 0.0);");
  });

  it("should generate shader that outputs vec3 var with padding", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 3, "col", "vec3", new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain("fragColor = vec4(col, 0.0);");
  });

  it("should inject _dbgCaptureCoord when captureCoordUniform=true", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "d", "float", new Map(), new Map(), true
    );
    expect(result).not.toBeNull();
    expect(result).toContain("uniform vec2 _dbgCaptureCoord;");
    expect(result).toContain("fragCoord = _dbgCaptureCoord;");
  });

  it("should return null for unknown varName not in scope", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "nonExistentVar", "float", new Map(), new Map(), false
    );
    expect(result).toBeNull();
  });

  it("should handle loop-scoped var with shadow variable", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      withLoop, 4, "val", "float", new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain("_dbgShadow");
  });

  it("should generate shader that packs mat2 columns into vec4", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      withMat2, 2, "m", "mat2", new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain("fragColor = vec4(m[0], m[1]);");
  });

  it("should work in whole-shader mode (debugLine=-1)", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, -1, "uv", "vec2", new Map(), new Map(), false
    );
    expect(result).not.toBeNull();
    expect(result).toContain("fragColor = vec4(uv, 0.0, 0.0);");
  });

  it("should inject non-square grid coord for wide grid (gridWidth > gridHeight)", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "d", "float", new Map(), new Map(), false, 128, 72
    );
    expect(result).not.toBeNull();
    expect(result).toContain("vec2(128.0, 72.0)");
  });

  it("should inject non-square grid coord for tall grid (gridHeight > gridWidth)", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "d", "float", new Map(), new Map(), false, 72, 128
    );
    expect(result).not.toBeNull();
    expect(result).toContain("vec2(72.0, 128.0)");
  });

  it("should inject square grid coord when gridWidth equals gridHeight", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "d", "float", new Map(), new Map(), false, 64, 64
    );
    expect(result).not.toBeNull();
    expect(result).toContain("vec2(64.0, 64.0)");
  });

  it("should not inject grid coord when captureCoordUniform=true (pixel mode)", () => {
    const result = VariableCaptureBuilder.generateCaptureShader(
      simpleMainImage, 2, "d", "float", new Map(), new Map(), true, 128, 72
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("vec2(128.0, 72.0)");
    expect(result).toContain("_dbgCaptureCoord");
  });
});

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

const withMultilineLoopAssignment = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  for (int i = 0; i < 10; i++) {
    vec2 rnd2 = vec2(
      sin(float(i)),
      cos(float(i)));
    fragColor = vec4(rnd2, 0.0, 1.0);
  }
}`;

const signatureBraceNextLine = `void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;

const helperWithOutParam = `float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {
  float tm = 0.0;
  p = ori + dir * tm;
  return tm;
}`;

const multiLineSignatureHelper = `vec2 bezier( vec2 p,
             vec2 v0, vec2 v1, vec2 v2, vec2 v3,
             vec2 wd, float bo )
{
    float ymi = min(min(v0.y,v1.y),min(v2.y,v3.y));
    float yma = max(max(v0.y,v1.y),max(v2.y,v3.y));
    if( p.y<ymi-bo || p.y>yma+bo ) return wd;

    const int num = 10;
    vec2 a = v0;
    for( int i=1; i<num; i++ )
    {
        float t = float(i)/float(num-1);
        vec2 b = wd;
        a = b;
    }
    return wd;
}`;

const multiReturnHelper = `float clouds(vec3 p, out float cloudHeight, bool sampleNoise) {
  if (p.y < 0.0) {
    return 0.0;
  }

  cloudHeight = p.y;
  float cloud = cloudHeight;
  if (cloud <= 0.0) {
    return 0.0;
  }

  float shape = cloud * 0.5;
  return shape;
}`;

const helperWithLaterDependency = `float clouds(vec3 p, out float cloudHeight, bool sampleNoise) {
  cloudHeight = saturateLater(p.y);
  return cloudHeight;
}

float saturateLater(float x) {
  return clamp(x, 0.0, 1.0);
}`;

const helperWithPreprocessorReturn = `vec2 evalBezier( float t, vec2 v0, vec2 v1, vec2 v2, vec2 v3 )
{
#if 0
    vec2 a0=v0+(v1-v0)*t, a1=v1+(v2-v1)*t, a2=v2+(v3-v2)*t;
    vec2 b0=a0+(a1-a0)*t, b1=a1+(a2-a1)*t;
    return  b0+(b1-b0)*t;
#else
    vec2 v21 = 3.0*(v2-v1);
    vec2 v10 = 3.0*(v1-v0);
    vec2 v03 =     (v0-v3);
    return (((v21-v10)-t*(v03+v21))*t+v10)*t+v0;
#endif    
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

const helperWithStructParam = `const int POINT_COUNT = 8;
struct CtrlPts
{
    vec2 p[POINT_COUNT];
};
vec2 PointArray(int i, CtrlPts ctrlPts)
{
    if(i==0 || i==POINT_COUNT  ) return ctrlPts.p[0];
    return ctrlPts.p[1];
}`;

const helperAfterMainImage = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}

float test() {
  return 0.0;
}`;

const mainImageUsingBuiltinFragCoord = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  vec3 col = vec3(uv, 0.0);
  fragColor = vec4(col, 1.0);
}`;

const withGlobals = `vec3 tint = vec3(1.0, 0.0, 0.0);
float exposure = 1.5;

float shade(vec2 uv) {
  float local = exposure * uv.x;
  return local;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = tint * uv.x;
  fragColor = vec4(col, 1.0);
}`;

const withShadowedGlobal = `float exposure = 1.5;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float exposure = 0.5;
  fragColor = vec4(exposure);
}`;

const commonGlobalsOnly = `vec3 red = vec3(1.0, 0.0, 0.0);
float exposure = 1.5;

vec3 helper(vec2 uv) {
  return red * uv.x * exposure;
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

  it("should include mainImage parameters on the function declaration line", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(simpleMainImage, 0);
    const names = vars.map(v => v.varName);
    expect(names).toContain("fragColor");
    expect(names).toContain("fragCoord");
  });

  it("should include parameters on the declaration line when brace is on next line", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(signatureBraceNextLine, 0);
    const names = vars.map(v => v.varName);
    expect(names).toContain("fragColor");
    expect(names).toContain("fragCoord");
  });

  it("should include out parameters for helper functions when they are in scope", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(helperWithOutParam, 3);
    const names = vars.map(v => v.varName);
    expect(names).toContain("ori");
    expect(names).toContain("dir");
    expect(names).toContain("p");
    expect(names).toContain("tm");
    expect(names).toContain("_dbgReturn");
  });

  it("should include _dbgReturn for helpers with multi-line signatures", () => {
    const shaderLines = multiLineSignatureHelper.split("\n");
    const returnLine = shaderLines.findIndex(line => line.trim() === "return wd;");
    const vars = VariableCaptureBuilder.getAllInScopeVariables(multiLineSignatureHelper, returnLine);
    const names = vars.map(v => v.varName);
    expect(names).toContain("wd");
    expect(names).toContain("_dbgReturn");
    const dbgReturn = vars.find(v => v.varName === "_dbgReturn");
    expect(dbgReturn?.varType).toBe("vec2");
  });

  it("should include referenced global variables when inside a helper function", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withGlobals, 4);
    const names = vars.map(v => v.varName);
    expect(names).toContain("local");
    expect(names).toContain("exposure");
    expect(names).not.toContain("tint");
  });

  it("should include referenced global variables when inside mainImage", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withGlobals, 10);
    const names = vars.map(v => v.varName);
    expect(names).toContain("uv");
    expect(names).toContain("col");
    expect(names).toContain("tint");
    expect(names).not.toContain("exposure");
  });

  it("should include all global variables when the cursor is in global scope", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withGlobals, 0);
    const names = vars.map(v => v.varName);
    expect(names).toContain("tint");
    expect(names).not.toContain("exposure");
  });

  it("should include later globals only after their declaration line in global scope", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withGlobals, 1);
    const names = vars.map(v => v.varName);
    expect(names).toContain("tint");
    expect(names).toContain("exposure");
  });

  it("should prefer local variables over shadowed globals", () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(withShadowedGlobal, 3);
    const exposureVars = vars.filter(v => v.varName === "exposure");
    expect(exposureVars).toHaveLength(1);
    expect(exposureVars[0].declarationLine).toBe(3);
  });

  it("should reject capture of globals declared after the selected global line", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      withGlobals,
      0,
      [{ varName: "exposure", varType: "float", declarationLine: 1 }],
      new Map(),
      new Map(),
      false,
    );

    expect(result).toBeNull();
  });
});

describe("VariableCaptureBuilder.generateMultiCaptureShader", () => {
  it("generates one selector shader for multiple mainImage variables", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      simpleMainImage,
      3,
      [
        { varName: "d", varType: "float", declarationLine: 2 },
        { varName: "col", varType: "vec3", declarationLine: 3 },
      ],
      new Map(),
      new Map(),
      false,
      43,
      24,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("uniform int _dbgVarIndex;");
    expect(result).toContain("if (_dbgVarIndex == 0)");
    expect(result).toContain("fragColor = vec4(d, 0.0, 0.0, 0.0);");
    expect(result).toContain("if (_dbgVarIndex == 1)");
    expect(result).toContain("fragColor = vec4(col, 0.0);");
    expect(result).toContain("vec2 _dbgRemappedFragCoord = gl_FragCoord.xy / vec2(43.0, 24.0) * iResolution.xy;");
  });

  it("injects pixel capture coordinate override for selector shaders", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      simpleMainImage,
      2,
      [{ varName: "d", varType: "float", declarationLine: 2 }],
      new Map(),
      new Map(),
      true,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("uniform int _dbgVarIndex;");
    expect(result).toContain("uniform vec2 _dbgCaptureCoord;");
    expect(result).toContain("vec2 _dbgRemappedFragCoord = _dbgCaptureCoord;");
  });

  it("generates one selector shader for helper function captures", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      helperWithOutParam,
      3,
      [
        { varName: "tm", varType: "float", declarationLine: 1 },
        { varName: "p", varType: "vec3", declarationLine: 0 },
      ],
      new Map(),
      new Map(),
      false,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("uniform int _dbgVarIndex;");
    expect(result).toContain("float _dbgCaptured0;");
    expect(result).toContain("vec3 _dbgCaptured1;");
    expect(result).toContain("_dbgCaptured0 = tm;");
    expect(result).toContain("_dbgCaptured1 = p;");
    expect(result).toContain("if (_dbgVarIndex == 0)");
    expect(result).toContain("fragColor = vec4(_dbgCaptured0, 0.0, 0.0, 0.0);");
    expect(result).toContain("if (_dbgVarIndex == 1)");
    expect(result).toContain("fragColor = vec4(_dbgCaptured1, 0.0);");
    expect(result!.match(/void mainImage\(out vec4 fragColor, in vec2 fragCoord\) \{/g)?.length).toBe(1);
  });

  it("generates one selector shader for global-scope captures", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      withGlobals,
      1,
      [
        { varName: "tint", varType: "vec3", declarationLine: 0 },
        { varName: "exposure", varType: "float", declarationLine: 1 },
      ],
      new Map(),
      new Map(),
      false,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("uniform int _dbgVarIndex;");
    expect(result).toContain("if (_dbgVarIndex == 0)");
    expect(result).toContain("fragColor = vec4(tint, 0.0);");
    expect(result).toContain("if (_dbgVarIndex == 1)");
    expect(result).toContain("fragColor = vec4(exposure, 0.0, 0.0, 0.0);");
  });

  it("generates one selector shader for externally declared uniforms", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      simpleMainImage,
      3,
      [
        { varName: "d", varType: "float", declarationLine: 2 },
        { varName: "customGain", varType: "float", declarationLine: -1 },
      ],
      new Map(),
      new Map(),
      false,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("if (_dbgVarIndex == 0)");
    expect(result).toContain("fragColor = vec4(d, 0.0, 0.0, 0.0);");
    expect(result).toContain("if (_dbgVarIndex == 1)");
    expect(result).toContain("fragColor = vec4(customGain, 0.0, 0.0, 0.0);");
  });

  it("generates one selector shader for loop-scoped mainImage captures using shadows", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      withLoop,
      4,
      [{ varName: "val", varType: "float", declarationLine: 4 }],
      new Map(),
      new Map(),
      false,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("float _dbgShadow0;");
    expect(result).toContain("_dbgShadow0 = val;");
    expect(result).toContain("fragColor = vec4(_dbgShadow0, 0.0, 0.0, 0.0);");
  });

  it("shadows loop locals from a closing-brace line so selector output stays in scope", () => {
    const result = VariableCaptureBuilder.generateMultiCaptureShader(
      withLoop,
      6,
      [
        { varName: "i", varType: "int", declarationLine: 3 },
        { varName: "val", varType: "float", declarationLine: 4 },
      ],
      new Map(),
      new Map(),
      false,
    );

    expect(result).not.toBeNull();
    expect(result).toContain("int _dbgShadow0;");
    expect(result).toContain("float _dbgShadow1;");
    expect(result).toContain("_dbgShadow0 = i;");
    expect(result).toContain("_dbgShadow1 = val;");
    expect(result).toContain("fragColor = vec4(float(_dbgShadow0), 0.0, 0.0, 0.0);");
    expect(result).toContain("fragColor = vec4(_dbgShadow1, 0.0, 0.0, 0.0);");
  });
});

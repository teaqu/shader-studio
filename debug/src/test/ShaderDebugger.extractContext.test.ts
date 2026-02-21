import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - extractFunctionContext', () => {
  const shader = `float sdf(vec2 p, float r) {
  float d = length(p) - r;
  return d;
}

vec3 getColor(vec2 uv) {
  return vec3(uv, 0.5);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float d = sdf(uv, 0.5);
  fragColor = vec4(vec3(d), 1.0);
}`;

  it('should return correct function name, return type, and parameters for a non-mainImage function', () => {
    const ctx = ShaderDebugger.extractFunctionContext(shader, 1);

    expect(ctx).not.toBeNull();
    expect(ctx!.functionName).toBe('sdf');
    expect(ctx!.returnType).toBe('float');
    expect(ctx!.isFunction).toBe(true);
    expect(ctx!.parameters).toHaveLength(2);
    expect(ctx!.parameters[0]).toMatchObject({ name: 'p', type: 'vec2' });
    expect(ctx!.parameters[1]).toMatchObject({ name: 'r', type: 'float' });
  });

  it('should return isFunction false for mainImage', () => {
    const ctx = ShaderDebugger.extractFunctionContext(shader, 10);

    expect(ctx).not.toBeNull();
    expect(ctx!.functionName).toBe('mainImage');
    expect(ctx!.isFunction).toBe(false);
  });

  it('should return null for global scope (no enclosing function)', () => {
    const globalShader = `#define PI 3.14159
float globalVar = 1.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;
    // Line 1 is in global scope
    const ctx = ShaderDebugger.extractFunctionContext(globalShader, 1);
    expect(ctx).toBeNull();
  });

  it('should generate correct default values for each parameter type', () => {
    const multiParamShader = `float fn(vec2 a, float b, vec3 c, vec4 d, int e, bool f) {
  return 0.0;
}`;
    const ctx = ShaderDebugger.extractFunctionContext(multiParamShader, 1);

    expect(ctx).not.toBeNull();
    const params = ctx!.parameters;
    expect(params).toHaveLength(6);

    // vec2 defaults to UV mode
    expect(params[0]).toMatchObject({ name: 'a', type: 'vec2', mode: 'uv', uvValue: 'uv' });
    // float defaults to custom
    expect(params[1]).toMatchObject({ name: 'b', type: 'float', mode: 'custom', defaultCustomValue: '0.5', uvValue: 'uv.x' });
    // vec3 defaults to custom
    expect(params[2]).toMatchObject({ name: 'c', type: 'vec3', mode: 'custom', defaultCustomValue: 'vec3(0.5)', uvValue: 'vec3(uv, 0.0)' });
    // vec4 defaults to custom
    expect(params[3]).toMatchObject({ name: 'd', type: 'vec4', mode: 'custom', defaultCustomValue: 'vec4(0.5)', uvValue: 'vec4(uv, 0.0, 1.0)' });
    // int defaults to custom
    expect(params[4]).toMatchObject({ name: 'e', type: 'int', mode: 'custom', defaultCustomValue: '1', uvValue: 'int(uv.x * 10.0)' });
    // bool defaults to custom
    expect(params[5]).toMatchObject({ name: 'f', type: 'bool', mode: 'custom', defaultCustomValue: 'true', uvValue: 'uv.x > 0.5' });
  });

  it('should handle sampler2D parameters with default value iChannel0', () => {
    const texShader = `vec4 sample(sampler2D tex, vec2 uv) {
  return texture(tex, uv);
}`;
    const ctx = ShaderDebugger.extractFunctionContext(texShader, 1);

    expect(ctx).not.toBeNull();
    expect(ctx!.parameters[0]).toMatchObject({
      name: 'tex',
      type: 'sampler2D',
      defaultCustomValue: 'iChannel0',
      mode: 'custom',
    });
  });

  it('should handle functions with no parameters', () => {
    const noParamShader = `float getRandom() {
  return 0.42;
}`;
    const ctx = ShaderDebugger.extractFunctionContext(noParamShader, 1);

    expect(ctx).not.toBeNull();
    expect(ctx!.functionName).toBe('getRandom');
    expect(ctx!.parameters).toHaveLength(0);
  });

  it('should handle out/inout parameter qualifiers, filtering out "out" params', () => {
    const qualifiedShader = `void setup(out vec3 color, inout float depth, in vec2 uv) {
  color = vec3(1.0);
  depth = 0.5;
}`;
    const ctx = ShaderDebugger.extractFunctionContext(qualifiedShader, 1);

    expect(ctx).not.toBeNull();
    // 'out' params are filtered out (they are outputs, not inputs)
    expect(ctx!.parameters).toHaveLength(2);
    expect(ctx!.parameters[0]).toMatchObject({ name: 'depth', type: 'float' });
    expect(ctx!.parameters[1]).toMatchObject({ name: 'uv', type: 'vec2' });
  });

  it('should filter out "out" params but keep "inout" params', () => {
    const shader = `float rayMarchR(vec3 ro, vec3 rd, float r, out vec3 pOut) {
  float t = 0.0;
  pOut = ro + rd * t;
  return t;
}`;
    const ctx = ShaderDebugger.extractFunctionContext(shader, 2);

    expect(ctx).not.toBeNull();
    expect(ctx!.parameters).toHaveLength(3);
    expect(ctx!.parameters[0]).toMatchObject({ name: 'ro', type: 'vec3' });
    expect(ctx!.parameters[1]).toMatchObject({ name: 'rd', type: 'vec3' });
    expect(ctx!.parameters[2]).toMatchObject({ name: 'r', type: 'float' });
    // pOut should NOT be in the list
    expect(ctx!.parameters.every(p => p.name !== 'pOut')).toBe(true);
  });

  it('should extract loop info for loops containing the debug line', () => {
    const loopShader = `float march(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 100; i++) {
    d += 0.01;
    float step = d * 0.1;
  }
  return d;
}`;
    // Debug line 4 is inside the for loop
    const ctx = ShaderDebugger.extractFunctionContext(loopShader, 4);

    expect(ctx).not.toBeNull();
    expect(ctx!.loops).toHaveLength(1);
    expect(ctx!.loops[0].loopIndex).toBe(0);
    expect(ctx!.loops[0].loopHeader).toContain('for');
    expect(ctx!.loops[0].lineNumber).toBe(2);
  });

  it('should return empty loops array when debug line is not inside any loop', () => {
    const ctx = ShaderDebugger.extractFunctionContext(shader, 1);

    expect(ctx).not.toBeNull();
    expect(ctx!.loops).toHaveLength(0);
  });

  it('should populate centeredUvValue for each parameter type', () => {
    const multiParamShader = `float fn(vec2 a, float b, vec3 c, vec4 d, int e, bool f) {
  return 0.0;
}`;
    const ctx = ShaderDebugger.extractFunctionContext(multiParamShader, 1);

    expect(ctx).not.toBeNull();
    const params = ctx!.parameters;

    // vec2: centered UV expression
    expect(params[0].centeredUvValue).toContain('fragCoord');
    expect(params[0].centeredUvValue).toContain('iResolution');
    // float: .x component of centered UV
    expect(params[1].centeredUvValue).toContain('.x');
    // vec3: vec3(centeredUv, 0.0)
    expect(params[2].centeredUvValue).toContain('vec3(');
    // vec4: vec4(centeredUv, 0.0, 1.0)
    expect(params[3].centeredUvValue).toContain('vec4(');
    // int: int(centeredUv.x * 10.0)
    expect(params[4].centeredUvValue).toContain('int(');
    // bool: fragCoord-based comparison
    expect(params[5].centeredUvValue).toContain('fragCoord');
  });

  it('should extract nested loop info', () => {
    const nestedLoopShader = `float compute(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 10; i++) {
    for (int j = 0; j < 5; j++) {
      d += float(i * j);
    }
  }
  return d;
}`;
    // Debug line 4 is inside both loops
    const ctx = ShaderDebugger.extractFunctionContext(nestedLoopShader, 4);

    expect(ctx).not.toBeNull();
    expect(ctx!.loops).toHaveLength(2);
    expect(ctx!.loops[0].loopIndex).toBe(0); // outer
    expect(ctx!.loops[1].loopIndex).toBe(1); // inner
  });
});

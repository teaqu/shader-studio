import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

describe('ShaderDebugManager - Function Context', () => {
  let manager: ShaderDebugManager;

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

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

  it('should cache code via setOriginalCode', () => {
    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');

    const state = manager.getState();
    expect(state.functionContext).not.toBeNull();
    expect(state.functionContext!.functionName).toBe('sdf');
  });

  it('should return null function context when no code is cached', () => {
    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');

    const state = manager.getState();
    expect(state.functionContext).toBeNull();
  });

  it('should extract function context with correct name, return type, and params', () => {
    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');

    const ctx = manager.getState().functionContext!;
    expect(ctx.functionName).toBe('sdf');
    expect(ctx.returnType).toBe('float');
    expect(ctx.isFunction).toBe(true);
    expect(ctx.parameters).toHaveLength(2);
    expect(ctx.parameters[0].name).toBe('p');
    expect(ctx.parameters[0].type).toBe('vec2');
    expect(ctx.parameters[1].name).toBe('r');
    expect(ctx.parameters[1].type).toBe('float');
  });

  it('should set isFunction false for mainImage', () => {
    manager.setOriginalCode(shader);
    manager.updateDebugLine(10, '  vec2 uv = fragCoord / iResolution.xy;', '/path/shader.glsl');

    const ctx = manager.getState().functionContext!;
    expect(ctx.functionName).toBe('mainImage');
    expect(ctx.isFunction).toBe(false);
  });

  it('should preserve custom parameters when cursor moves within same function', () => {
    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');
    manager.setCustomParameter(0, 'vec2(1.0)');

    // Move to a different line in the same function
    manager.updateDebugLine(2, '  return d;', '/path/shader.glsl');

    expect(manager.getCustomParameters().get(0)).toBe('vec2(1.0)');
    expect(manager.getState().functionContext!.functionName).toBe('sdf');
  });

  it('should clear custom parameters when switching to a different function', () => {
    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');
    manager.setCustomParameter(0, 'vec2(1.0)');
    manager.setLoopMaxIterations(0, 10);

    // Move to getColor function
    manager.updateDebugLine(6, '  return vec3(uv, 0.5);', '/path/shader.glsl');

    expect(manager.getCustomParameters().size).toBe(0);
    expect(manager.getLoopMaxIterations().size).toBe(0);
    expect(manager.getState().functionContext!.functionName).toBe('getColor');
  });

  it('should update function context when switching between non-mainImage functions', () => {
    manager.setOriginalCode(shader);

    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');
    expect(manager.getState().functionContext!.functionName).toBe('sdf');

    manager.updateDebugLine(6, '  return vec3(uv, 0.5);', '/path/shader.glsl');
    const ctx = manager.getState().functionContext!;
    expect(ctx.functionName).toBe('getColor');
    expect(ctx.parameters).toHaveLength(1);
    expect(ctx.parameters[0].name).toBe('uv');
    expect(ctx.parameters[0].type).toBe('vec2');
  });

  it('should include loop info in function context', () => {
    const shaderWithLoop = `float march(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 100; i++) {
    d += 0.01;
  }
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

    manager.setOriginalCode(shaderWithLoop);
    manager.updateDebugLine(3, '    d += 0.01;', '/path/shader.glsl');

    const ctx = manager.getState().functionContext!;
    expect(ctx.functionName).toBe('march');
    expect(ctx.loops).toHaveLength(1);
    expect(ctx.loops[0].loopIndex).toBe(0);
    expect(ctx.loops[0].loopHeader).toContain('for');
  });
});

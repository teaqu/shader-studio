import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Standalone Function Calls', () => {
  it('should debug a standalone function call that returns vec3', () => {
    const shader = `vec3 red() {
    return vec3(1.0, 0.0, 0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    red();
    fragColor = vec4(0.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 6, '    red();');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 _dbgCall = red()');
      expect(result).toContain('fragColor = vec4(_dbgCall, 1.0)');
    }
  });

  it('should debug a standalone function call that returns float', () => {
    const shader = `float sdf(vec2 p) {
    return length(p) - 0.5;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    sdf(uv);
    fragColor = vec4(0.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 6, '    sdf(uv);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float _dbgCall = sdf(uv)');
      expect(result).toContain('fragColor = vec4(vec3(_dbgCall), 1.0)');
    }
  });

  it('should debug a standalone function call with arguments', () => {
    const shader = `vec4 getColor(vec2 p, float t) {
    return vec4(p, t, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    getColor(uv, 0.5);
    fragColor = vec4(0.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 6, '    getColor(uv, 0.5);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec4 _dbgCall = getColor(uv, 0.5)');
      expect(result).toContain('fragColor = _dbgCall');
    }
  });

  it('should not debug a void function call', () => {
    const shader = `void doNothing() {
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    doNothing();
    fragColor = vec4(0.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    doNothing();');

    expect(result).toBeNull();
  });

  it('should not confuse if/for/while with function calls', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    if (uv.x > 0.5) {
        fragColor = vec4(1.0);
    }
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 2, '    if (uv.x > 0.5) {');

    expect(result).toBeNull();
  });

  it('should debug function call in a helper function', () => {
    const shader = `vec3 red() {
    return vec3(1.0, 0.0, 0.0);
}

vec3 getOutput(vec2 p) {
    red();
    return vec3(0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = getOutput(uv);
    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    red();');

    expect(result).not.toBeNull();
    if (result) {
      // In helper function path, the call is captured in the helper and returned,
      // then the wrapper mainImage calls the helper and visualizes 'result'
      expect(result).toContain('vec3 _dbgCall = red()');
      expect(result).toContain('return _dbgCall');
      expect(result).toContain('fragColor = vec4(result, 1.0)');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Full Function Execution (no variable on line)', () => {
  const basicShader = `float sdf(vec2 p) {
  float d = length(p) - 0.5;
  d = abs(d);
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;

  it('should run full function when no variable detected on line in non-mainImage function', () => {
    // Line 0 is the function declaration — no variable to detect
    const result = ShaderDebugger.modifyShaderForDebugging(basicShader, 0, 'float sdf(vec2 p) {');

    expect(result).not.toBeNull();
    if (result) {
      // Full function body preserved (not truncated)
      expect(result).toContain('float d = length(p) - 0.5;');
      expect(result).toContain('d = abs(d);');
      expect(result).toContain('return d;');
      // Wrapper mainImage generated
      expect(result).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
      expect(result).toContain('sdf(uv)');
      // Visualizes as float
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should return null when no variable detected on line in mainImage', () => {
    // An empty or comment line in mainImage — no variable
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // just a comment
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '  // just a comment');
    expect(result).toBeNull();
  });

  it('should return null for void function with no variable on line', () => {
    const shader = `void setup(vec2 p) {
  float x = length(p);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;
    // Line 0 is the void function declaration — can't visualize void return
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 0, 'void setup(vec2 p) {');
    expect(result).toBeNull();
  });

  it('should use custom parameters for full function execution', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(
      basicShader, 0, 'float sdf(vec2 p) {',
      new Map(), // no loop caps
      new Map([[0, 'vec2(0.3, 0.7)']]) // custom vec2 param
    );

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('sdf(vec2(0.3, 0.7))');
      expect(result).not.toContain('sdf(uv)');
    }
  });

  it('should cap loops in full function execution', () => {
    const shader = `float march(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 100; i++) {
    d += 0.01;
  }
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(
      shader, 0, 'float march(vec2 p) {',
      new Map([[0, 15]]), // cap first loop at 15
    );

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('int _dbgIter0 = 0;');
      expect(result).toContain('if (++_dbgIter0 > 15) break;');
      // Full body preserved
      expect(result).toContain('return d;');
    }
  });

  it('should pass custom parameters through to helper function wrapper path', () => {
    const shader = `float sdf(vec2 p, float r) {
  float d = length(p) - r;
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(0.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(
      shader, 1, '  float d = length(p) - r;',
      new Map(),
      new Map([[1, '2.0']]), // override r parameter
    );

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('sdf(uv, 2.0)');
    }
  });

  it('should pass loopMaxIterations through to mainImage truncation path', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float d = 0.0;
  for (int i = 0; i < 50; i++) {
    d += 0.02;
  }
  fragColor = vec4(vec3(d), 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(
      shader, 2, '  float d = 0.0;',
      new Map([[0, 8]]), // cap the loop
    );

    expect(result).not.toBeNull();
    if (result) {
      // Loop is after debug line, so it's truncated away. But the cap map is passed through.
      // The important thing is that it doesn't crash.
      expect(result).toContain('float d = 0.0;');
    }
  });

  it('should handle multi-param function in full execution mode', () => {
    const shader = `vec3 getColor(vec2 uv, float time, vec3 baseColor) {
  vec3 c = baseColor * sin(time);
  c += vec3(uv, 0.0);
  return c;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

    // Line 0 is function declaration — triggers full function execution
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 0, 'vec3 getColor(vec2 uv, float time, vec3 baseColor) {');

    expect(result).not.toBeNull();
    if (result) {
      // Full body preserved
      expect(result).toContain('vec3 c = baseColor * sin(time);');
      expect(result).toContain('return c;');
      // Default params used in wrapper
      expect(result).toContain('getColor(uv, 0.5, vec3(0.5))');
      // Visualized as vec3
      expect(result).toContain('fragColor = vec4(result, 1.0)');
    }
  });
});

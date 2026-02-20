import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Loop Handling', () => {
  it('should extract loop initialization and run body once', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++) {
    float x = float(i) * 0.1;
    uv.x += x;
  }

  fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    float x = float(i) * 0.1;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');
      expect(result).toContain('float x = float(i) * 0.1');
      expect(result).toContain('fragColor = vec4(vec3(x), 1.0)');
    }
  });

  it('should handle nested loops by extracting both initializations', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++) {
    for (int j = 0; j < 5; j++) {
      float val = float(i + j);
    }
  }

  fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '      float val = float(i + j);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).toContain('int j = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');
      expect(result).not.toContain('for (int j = 0; j < 5; j++)');
      expect(result).toContain('float val = float(i + j)');
      expect(result).toContain('fragColor = vec4(vec3(val), 1.0)');
    }
  });

  it('should handle for loop with existing variable', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  int i;

  for (i = 0; i < 10; i++) {
    float x = float(i) * 0.1;
  }

  fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    float x = float(i) * 0.1;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('i = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (i = 0; i < 10; i++)');
      expect(result).toContain('float x = float(i) * 0.1');
    }
  });

  it('should handle loop with complex initialization', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (float t = 0.0; t < 1.0; t += 0.1) {
    vec3 color = vec3(t);
  }

  fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    vec3 color = vec3(t);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float t = 0.0;  // Loop init (first iteration only)');
      expect(result).toContain('vec3 color = vec3(t)');
      expect(result).toContain('fragColor = vec4(color, 1.0)');
    }
  });

  it('should handle loop with opening brace on same line', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++) {
    float x = float(i);
  }
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    float x = float(i);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');
    }
  });

  it('should handle loop with opening brace on next line', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++)
  {
    float x = float(i);
  }
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    float x = float(i);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');
    }
  });

  it('should handle loop inside helper function', () => {
    const shader = `vec2 foldX(vec2 p) {
    p.x = abs(p.x);
    return p;
}

float sdBox( vec2 p, vec2 b ) {
    vec2 q = abs(p) - b;
    return length(max(q,0.0)) + min(max(q.x,q.y),0.0);
}

float dTree(vec2 p) {
    float scale = 0.8;
    vec2 size = vec2(0.01, .20);
    float d = sdBox(p, size);
    for (int i = 0; i < 4; i++) {
        vec2 q = foldX(p);
        q.y -= size.y;
        q.xy *= rotate(-0.5);
        d = min(d, sdBox(p, size));
        p = q;
        size *= scale;
    }
    return d;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    uv -= 0.5;
    uv.y += 0.25;
    uv /= 0.9;
    float tree = step(0.01, dTree(uv));
    fragColor = vec4(vec3(tree), 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 16, '        vec2 q = foldX(p);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 foldX(vec2 p)');
      expect(result).toContain('float sdBox( vec2 p, vec2 b )');
      expect(result).toContain('vec2 dTree(vec2 p)');
      expect(result).not.toContain('float dTree(vec2 p)');
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (int i = 0; i < 4; i++)');
      expect(result).toContain('vec2 q = foldX(p)');
      expect(result).toContain('return q;');
      expect(result).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
      expect(result).toContain('fragColor = vec4(');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Loop Handling', () => {
  it('should use shadow variable and keep full loop body when debug line is inside a loop', () => {
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
      expect(result).toContain('for (int i = 0; i < 10; i++)');
      expect(result).toContain('float x = float(i) * 0.1');
      // Shadow variable declared before loop, assigned after debug line
      expect(result).toContain('float _dbgShadow;');
      expect(result).toContain('_dbgShadow = x;');
      // Full loop body preserved (code after debug line kept)
      expect(result).toContain('uv.x += x;');
      // fragColor uses shadow variable
      expect(result).toContain('fragColor = vec4(vec3(_dbgShadow), 1.0)');
      // Post-loop code truncated
      expect(result).not.toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('should use shadow variable with nested loops and keep both loop bodies', () => {
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
      expect(result).toContain('for (int i = 0; i < 10; i++)');
      expect(result).toContain('for (int j = 0; j < 5; j++)');
      expect(result).toContain('float val = float(i + j)');
      // Shadow variable
      expect(result).toContain('float _dbgShadow;');
      expect(result).toContain('_dbgShadow = val;');
      expect(result).toContain('fragColor = vec4(vec3(_dbgShadow), 1.0)');
      // Post-outermost-loop code truncated
      expect(result).not.toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('should keep for loop with existing variable intact', () => {
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
      expect(result).toContain('for (i = 0; i < 10; i++)');
      expect(result).toContain('float x = float(i) * 0.1');
    }
  });

  it('should use shadow variable with complex loop initialization', () => {
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
      expect(result).toContain('for (float t = 0.0; t < 1.0; t += 0.1)');
      expect(result).toContain('vec3 color = vec3(t)');
      expect(result).toContain('vec3 _dbgShadow;');
      expect(result).toContain('_dbgShadow = color;');
      expect(result).toContain('fragColor = vec4(_dbgShadow, 1.0)');
    }
  });

  it('should keep loop with opening brace on same line', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++) {
    float x = float(i);
  }
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    float x = float(i);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('for (int i = 0; i < 10; i++)');
      expect(result).toContain('float x = float(i)');
    }
  });

  it('should keep loop with opening brace on next line', () => {
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
      expect(result).toContain('for (int i = 0; i < 10; i++)');
      expect(result).toContain('float x = float(i)');
    }
  });

  it('should not use shadow variable when debug line is not inside a loop', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++) {
    float x = float(i);
  }

  float result = length(uv);
  fragColor = vec4(vec3(result), 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 7, '  float result = length(uv);');

    expect(result).not.toBeNull();
    if (result) {
      // No shadow variable — debug line is after the loop
      expect(result).not.toContain('_dbgShadow');
      expect(result).toContain('float result = length(uv)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('should apply loop capping with shadow variable (raymarcher pattern)', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float d = 0.0;
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv, 1.0));

  for (int i = 0; i < 100; i++) {
    vec3 p = ro + d * rd;
    float cd = length(p) - 1.0;
    d += cd;
    if (cd < 0.001) break;
  }

  vec3 color = vec3(d);
  fragColor = vec4(color, 1.0);
}`;

    // Debug line is "float cd = length(p) - 1.0;" at line 8, cap loop at 5
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 8, '    float cd = length(p) - 1.0;', new Map([[0, 5]]));

    expect(result).not.toBeNull();
    if (result) {
      // Shadow variable
      expect(result).toContain('float _dbgShadow;');
      expect(result).toContain('_dbgShadow = cd;');
      // Loop capping
      expect(result).toContain('int _dbgIter0 = 0;');
      expect(result).toContain('if (++_dbgIter0 > 5) break;');
      // Full loop body preserved
      expect(result).toContain('d += cd;');
      expect(result).toContain('if (cd < 0.001) break;');
      // Post-loop truncated
      expect(result).not.toContain('vec3 color = vec3(d)');
      // Output uses shadow
      expect(result).toContain('fragColor = vec4(vec3(_dbgShadow), 1.0)');
    }
  });

  it('should extract only containing loops in function context', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 5; i++) {
    uv.x += float(i);
  }

  for (int j = 0; j < 10; j++) {
    for (int k = 0; k < 3; k++) {
      float val = float(j + k);
    }
  }

  fragColor = vec4(uv, 0.0, 1.0);
}`;

    // Debug line 9: "float val = float(j + k);" — inside both j-loop and k-loop
    const context = ShaderDebugger.extractFunctionContext(shader, 9);

    expect(context).not.toBeNull();
    if (context) {
      // Should only contain the two loops that surround the debug line (j and k loops)
      // NOT the i-loop which is completed before the debug line
      expect(context.loops.length).toBe(2);
      expect(context.loops[0].loopHeader).toContain('int j = 0');
      expect(context.loops[1].loopHeader).toContain('int k = 0');
      // loopIndex should be sequential across ALL loops (i=0, j=1, k=2)
      expect(context.loops[0].loopIndex).toBe(1);
      expect(context.loops[1].loopIndex).toBe(2);
      // endLine should be set
      expect(context.loops[0].endLine).toBeGreaterThan(context.loops[0].lineNumber);
      expect(context.loops[1].endLine).toBeGreaterThan(context.loops[1].lineNumber);
    }
  });

  it('should use shadow variable in non-mainImage function with loop', () => {
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
      // Loop is preserved with full body
      expect(result).toContain('for (int i = 0; i < 4; i++)');
      expect(result).toContain('vec2 q = foldX(p)');
      // Shadow variable used instead of direct return
      expect(result).toContain('vec2 _dbgShadow;');
      expect(result).toContain('_dbgShadow = q;');
      expect(result).toContain('return _dbgShadow;');
      // Full loop body preserved
      expect(result).toContain('q.xy *= rotate(-0.5)');
      expect(result).toContain('size *= scale');
      expect(result).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
      expect(result).toContain('fragColor = vec4(');
    }
  });
});

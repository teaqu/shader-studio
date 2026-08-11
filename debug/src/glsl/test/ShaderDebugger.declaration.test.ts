import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Variable Declarations', () => {
  it('should handle variable declared without initialization, then assigned', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 fuv = uv;
    fuv.x *= 40.0;
    vec3 col = vec3(0.2,0.6, 0.3);
    vec3 col2 = vec3(0.1,0.4, 0.9);
    vec3 col3 = vec3(1.0, 0.0, 0.0);

    vec3 wp;
    wp = smoothstep(1.4, 0.5, fract(vec3(fuv.x))) * 1.5;
    wp = smoothstep(0.1, 2.4, fract(vec3(fuv.x))) + 1.0;
    wp *= mix(col, mix(col2, col3, uv.y), uv.x);
    fragColor = vec4(wp,1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 10, '    wp = smoothstep(1.4, 0.5, fract(vec3(fuv.x))) * 1.5;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 wp;');
      expect(result).toContain('wp = smoothstep(1.4, 0.5, fract(vec3(fuv.x))) * 1.5');
      expect(result).toContain('fragColor = vec4(wp, 1.0)');
    }
  });

  it('should handle assignment with type keyword in expression', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 color;
    color = vec3(uv, 0.5);
    fragColor = vec4(color, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    color = vec3(uv, 0.5);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('color = vec3(uv, 0.5)');
      expect(result).toContain('fragColor = vec4(color, 1.0)');
    }
  });

  it('should not match == comparisons', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float x = 0.5;
    if (x == 0.5) {
        x = 1.0;
    }
    fragColor = vec4(vec3(x), 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    if (x == 0.5) {');
    expect(result).not.toBeNull();
    expect(result).toContain('float x = 0.5;');
    expect(result).toContain('fragColor = vec4(vec3(x), 1.0)');
  });

  it('should not climb upward on malformed declarations', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 color = ;
    fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 2, '    vec3 color = ;');
    expect(result).not.toBeNull();
    expect(result).toContain('vec3 color = ;');
    expect(result).not.toContain('fragColor = vec4(uv, 0.0, 1.0); // Debug: visualize vec2 (RG channels)');
  });

  it('should preserve invalid control-flow syntax instead of climbing upward', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    if (
    fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 2, '    if (');
    expect(result).toBe(shader);
  });

  it('should handle multiple assignments to same variable', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 wp;
    wp = smoothstep(1.4, 0.5, fract(vec3(uv.x))) * 1.5;
    wp = smoothstep(0.1, 2.4, fract(vec3(uv.x))) + 1.0;
    wp *= mix(vec3(0.2), vec3(0.9), uv.x);
    fragColor = vec4(wp, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    wp = smoothstep(0.1, 2.4, fract(vec3(uv.x))) + 1.0;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('wp = smoothstep(1.4, 0.5, fract(vec3(uv.x))) * 1.5');
      expect(result).toContain('wp = smoothstep(0.1, 2.4, fract(vec3(uv.x))) + 1.0');
      expect(result).toContain('fragColor = vec4(wp, 1.0)');
    }
  });

  it('should handle compound assignment with type keyword in expression', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 wp = vec3(0.5);
    wp *= mix(vec3(0.2), vec3(0.9), uv.x);
    fragColor = vec4(wp, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    wp *= mix(vec3(0.2), vec3(0.9), uv.x);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('wp *= mix(vec3(0.2), vec3(0.9), uv.x)');
      expect(result).toContain('fragColor = vec4(wp, 1.0)');
    }
  });

  it('should handle multi-line variable declaration', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = palette(length(uv) + iTime/4.0,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5),
      vec3(1.0, 1.0, 1.0),
      vec3(0.263, 0.416, 0.557)
    );
    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 2, '    vec3 col = palette(length(uv) + iTime/4.0,');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 col = palette');
      expect(result).toContain('fragColor = vec4(col, 1.0)');
    }
  });

  it('should handle multi-line assignment (not declaration)', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col;
    col = palette(length(uv) + iTime/4.0,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5)
    );
    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    col = palette(length(uv) + iTime/4.0,');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 col;');
      expect(result).toContain('col = palette');
      expect(result).toContain('fragColor = vec4(col, 1.0)');
    }
  });

  it('should handle assignment split with equals on first line and value on next', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 wp;
    wp =
      smoothstep(1.4, 0.5, fract(vec3(uv.x))) * 1.5;
    fragColor = vec4(wp, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    wp = ');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 wp;');
      expect(result).toContain('wp =');
      expect(result).toContain('smoothstep');
      expect(result).toContain('fragColor = vec4(wp, 1.0)');
    }
  });

  it('should handle hovering over middle line of multi-line declaration', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = palette(length(uv) + iTime/4.0,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5),
      vec3(1.0, 1.0, 1.0),
      vec3(0.263, 0.416, 0.557)
    );
    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '      vec3(0.5, 0.5, 0.5),');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 col = palette');
      expect(result).toContain('fragColor = vec4(col, 1.0)');
    }
  });

  it('should find enclosing mainImage when debug line follows a for loop (real braces)', () => {
    const shader = `float ring(float inner, float outer, float dist) {
    return step(dist, outer) - step(dist, inner);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float dist = length(uv);
    int k = 0;

    for (int i = 0; i < 100; ++i) {
      k += i;
    }

    vec3 col = vec3(0.0);
}`;
    // Debug line 13 = "    vec3 col = vec3(0.0);" — after the for loop's closing }
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 13, '    vec3 col = vec3(0.0);');

    expect(result).not.toBeNull();
    if (result) {
      // Must include prior context lines — not fall through to one-liner wrapper
      expect(result).toContain('vec2 uv =');
      expect(result).toContain('float dist =');
      expect(result).toContain('vec3 col = vec3(0.0)');
      expect(result).toContain('fragColor = vec4(col, 1.0)');
    }
  });

  it('should find enclosing mainImage when debug line follows a commented-out for loop', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    // for (int i = 0; i < 10; ++i) {
    //   uv += 0.01;
    // }
    vec3 col = vec3(uv, 0.0);
}`;
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    vec3 col = vec3(uv, 0.0);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv =');
      expect(result).toContain('vec3 col = vec3(uv, 0.0)');
      expect(result).toContain('fragColor = vec4(col, 1.0)');
    }
  });
});

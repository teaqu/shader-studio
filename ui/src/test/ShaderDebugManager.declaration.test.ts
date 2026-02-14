import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Variable Declarations', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

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

    // Debug line 10: wp = smoothstep(1.4, 0.5, fract(vec3(fuv.x))) * 1.5;
    manager.updateDebugLine(10, '    wp = smoothstep(1.4, 0.5, fract(vec3(fuv.x))) * 1.5;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 10, 0);

    console.log('\n=== DECLARATION: Variable declared then assigned (with vec3 in expression) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should detect wp as vec3
      expect(result).toContain('vec3 wp;');
      expect(result).toContain('wp = smoothstep(1.4, 0.5, fract(vec3(fuv.x))) * 1.5');
      expect(result).toContain('fragColor = vec4(wp, 1.0)'); // Should visualize wp as vec3
    }
  });

  it('should handle assignment with type keyword in expression', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 color;
    color = vec3(uv, 0.5);
    fragColor = vec4(color, 1.0);
}`;

    manager.updateDebugLine(3, '    color = vec3(uv, 0.5);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== DECLARATION: Assignment with vec3() constructor ===');
    console.log('Result:', result);

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

    // Line 3 has == comparison, should not be detected
    manager.updateDebugLine(3, '    if (x == 0.5) {', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== DECLARATION: Should not match == comparison ===');
    console.log('Result:', result);

    // Should fail to detect because == is not an assignment
    expect(result).toBeNull();
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

    // Debug second assignment
    manager.updateDebugLine(4, '    wp = smoothstep(0.1, 2.4, fract(vec3(uv.x))) + 1.0;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 4, 0);

    console.log('\n=== DECLARATION: Second assignment to same variable ===');
    console.log('Result:', result);

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

    manager.updateDebugLine(3, '    wp *= mix(vec3(0.2), vec3(0.9), uv.x);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== DECLARATION: Compound assignment with vec3 in expression ===');
    console.log('Result:', result);

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

    // Debug first line of multi-line declaration
    manager.updateDebugLine(2, '    vec3 col = palette(length(uv) + iTime/4.0,', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 2, 0);

    console.log('\n=== MULTI-LINE: Variable declaration spanning multiple lines ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should detect col as vec3
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

    // Debug first line of multi-line assignment
    manager.updateDebugLine(3, '    col = palette(length(uv) + iTime/4.0,', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== MULTI-LINE: Assignment spanning multiple lines ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should detect col as vec3 from earlier declaration
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

    // Debug first line of split assignment (just "wp =")
    manager.updateDebugLine(3, '    wp = ', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== MULTI-LINE: Assignment split across lines (wp = on one line) ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should detect wp as vec3
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

    // Debug MIDDLE line of multi-line declaration (not the first line!)
    manager.updateDebugLine(3, '      vec3(0.5, 0.5, 0.5),', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== MULTI-LINE: Hovering over middle line ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should still detect col as vec3 by combining all lines
      expect(result).toContain('vec3 col = palette');
      expect(result).toContain('fragColor = vec4(col, 1.0)');
    }
  });
});

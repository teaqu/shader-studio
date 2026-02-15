import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../../debug/ShaderDebugger';

describe('ShaderDebugger - Compound Assignments', () => {
  it('should truncate at compound assignment line', () => {
    const shader = `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    // Offset UVs for separate shapes
    vec2 uvSquare = uv + vec2(0.3, 0.0); // move square left
    vec2 uvCircle = uv - vec2(0.3, 0.0); // move circle right

    float sq = smoothstep(0.105, 0.1, max(abs(uvSquare.x), abs(uvSquare.y)));
    float c  = smoothstep(0.105, 0.1, length(uvCircle));

    vec3 col = vec3(1.0); // white background

    // Subtract shapes to make them visible
    col -= vec3(1.0, 0.0, 0.0) * sq; // red square
    col -= vec3(0.0, 0.0, 0.0) * c;  // white circle does nothing, so:
    col -= vec3(0.2) * c;            // dim circle to make it visible

    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 16, '    col -= vec3(0.2) * c;            // dim circle to make it visible');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('col -= vec3(0.2) * c;');
      expect(result).toContain('fragColor = vec4(col, 1.0); // Debug: visualize vec3 as RGB');
      const fragColorMatches = result.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(fragColorMatches).not.toBeNull();
      expect(fragColorMatches?.length).toBe(1);
    }
  });

  it('should handle first compound assignment in series', () => {
    const shader = `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = vec3(1.0);

    col -= vec3(1.0, 0.0, 0.0);
    col -= vec3(0.0, 1.0, 0.0);
    col -= vec3(0.0, 0.0, 1.0);

    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    col -= vec3(1.0, 0.0, 0.0);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('col -= vec3(1.0, 0.0, 0.0);');
      expect(result).not.toContain('col -= vec3(0.0, 1.0, 0.0);');
      expect(result).not.toContain('col -= vec3(0.0, 0.0, 1.0);');
      expect(result).toContain('fragColor = vec4(col, 1.0); // Debug: visualize vec3 as RGB');
      const fragColorMatches = result.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(fragColorMatches).not.toBeNull();
      expect(fragColorMatches?.length).toBe(1);
    }
  });

  it('should handle lines with comments that do not end with semicolon', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = vec3(1.0);

    col -= vec3(1.0, 0.0, 0.0);  // red square
    col -= vec3(0.0, 1.0, 0.0);  // green circle:
    col -= vec3(0.0, 0.0, 1.0);  // blue triangle!

    fragColor = vec4(col, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    col -= vec3(0.0, 1.0, 0.0);  // green circle:');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('col -= vec3(0.0, 1.0, 0.0);');
      expect(result).not.toContain('col -= vec3(0.0, 0.0, 1.0);');
      expect(result).toContain('fragColor = vec4(col, 1.0); // Debug: visualize vec3 as RGB');
      const fragColorMatches = result.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(fragColorMatches).not.toBeNull();
      expect(fragColorMatches?.length).toBe(1);
    }
  });

  it('should handle lines with comments ending in various punctuation', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = vec3(0.0);

    col += vec3(0.5);  // add gray?
    col *= vec3(2.0);  // double it!
    col -= vec3(0.1);  // subtract a bit,

    fragColor = vec4(col, 1.0);
}`;

    const result1 = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    col += vec3(0.5);  // add gray?');
    const result2 = ShaderDebugger.modifyShaderForDebugging(shader, 5, '    col *= vec3(2.0);  // double it!');
    const result3 = ShaderDebugger.modifyShaderForDebugging(shader, 6, '    col -= vec3(0.1);  // subtract a bit,');

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();

    if (result1) {
      const matches = result1.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(matches?.length).toBe(1);
    }
    if (result2) {
      const matches = result2.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(matches?.length).toBe(1);
    }
    if (result3) {
      const matches = result3.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(matches?.length).toBe(1);
    }
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Compound Assignments', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

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

    // Debug line 16 (0-indexed): col -= vec3(0.2) * c;
    manager.updateDebugLine(16, '    col -= vec3(0.2) * c;            // dim circle to make it visible', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 16, 0);

    console.log('\n=== COMPOUND ASSIGNMENT: Truncate at compound assignment ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the debug line
      expect(result).toContain('col -= vec3(0.2) * c;');

      // Should visualize col as vec3
      expect(result).toContain('fragColor = vec4(col, 1.0); // Debug: visualize vec3 as RGB');

      // Should NOT have the original fragColor line (it should be replaced, not duplicated)
      const fragColorMatches = result.match(/fragColor = vec4\(col, 1\.0\)/g);
      expect(fragColorMatches).not.toBeNull();
      expect(fragColorMatches?.length).toBe(1); // Should appear only ONCE (the debug line)
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

    // Debug line 5 (0-indexed): col -= vec3(1.0, 0.0, 0.0);
    manager.updateDebugLine(5, '    col -= vec3(1.0, 0.0, 0.0);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 5, 0);

    console.log('\n=== COMPOUND ASSIGNMENT: First in series ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include first compound assignment
      expect(result).toContain('col -= vec3(1.0, 0.0, 0.0);');

      // Should NOT include later assignments
      expect(result).not.toContain('col -= vec3(0.0, 1.0, 0.0);');
      expect(result).not.toContain('col -= vec3(0.0, 0.0, 1.0);');

      // Should visualize col (and ONLY have the debug fragColor, not the original)
      expect(result).toContain('fragColor = vec4(col, 1.0); // Debug: visualize vec3 as RGB');

      // fragColor should appear only once (the debug line)
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

    // Debug line 5 (0-indexed): line with comment ending in colon
    manager.updateDebugLine(5, '    col -= vec3(0.0, 1.0, 0.0);  // green circle:', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 5, 0);

    console.log('\n=== COMMENTS: Line with comment ending in colon ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the debug line
      expect(result).toContain('col -= vec3(0.0, 1.0, 0.0);');

      // Should NOT include later assignments (comment shouldn't cause multi-line detection)
      expect(result).not.toContain('col -= vec3(0.0, 0.0, 1.0);');

      // Should visualize col
      expect(result).toContain('fragColor = vec4(col, 1.0); // Debug: visualize vec3 as RGB');

      // Should NOT include original fragColor line
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

    // Debug each line with different comment endings
    manager.updateDebugLine(4, '    col += vec3(0.5);  // add gray?', 'test.glsl');
    const result1 = manager.modifyShaderForDebugging(shader, 4, 0);

    manager.updateDebugLine(5, '    col *= vec3(2.0);  // double it!', 'test.glsl');
    const result2 = manager.modifyShaderForDebugging(shader, 5, 0);

    manager.updateDebugLine(6, '    col -= vec3(0.1);  // subtract a bit,', 'test.glsl');
    const result3 = manager.modifyShaderForDebugging(shader, 6, 0);

    console.log('\n=== COMMENTS: Different punctuation endings ===');

    // All should truncate correctly (only one fragColor line)
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

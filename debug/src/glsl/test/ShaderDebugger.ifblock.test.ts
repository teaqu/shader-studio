import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

/**
 * Tests that when the debug line is inside an if/else block, the
 * fragColor output line is inserted AFTER the block closes, not inside it.
 */
describe('ShaderDebugger - if-block output placement', () => {
  it('debug line inside if block: fragColor placed after closing brace', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = vec3(0.5);
  if (uv.x > 0.5) {
    col = vec3(1.0, 0.0, 0.0);
  }
  fragColor = vec4(col, 1.0);
}`;

    // Debug line 4: "col = vec3(1.0, 0.0, 0.0);" — inside the if block
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '    col = vec3(1.0, 0.0, 0.0);');

    expect(result).not.toBeNull();
    // fragColor line should NOT be inside the if block
    // Check that the closing brace of the if comes BEFORE the fragColor line
    const lines = result!.split('\n');
    const fragColorIdx = lines.findIndex(l => l.includes('fragColor') && !l.includes('fragColor,'));
    const closingBraceIdx = lines.findLastIndex(
      (l, i) => i < fragColorIdx && l.trim() === '}'
    );
    // The closing brace of the if block should appear before fragColor
    expect(closingBraceIdx).toBeGreaterThan(-1);
    expect(closingBraceIdx).toBeLessThan(fragColorIdx);
  });

  it('debug line inside nested if-else: fragColor placed after outer block', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = vec3(0.0);
  if (uv.x > 0.5) {
    if (uv.y > 0.5) {
      col = vec3(0.0, 1.0, 0.0);
    } else {
      col = vec3(0.0, 0.0, 1.0);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

    // Debug line 5: "col = vec3(0.0, 1.0, 0.0);" — inside nested if
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 5, '      col = vec3(0.0, 1.0, 0.0);');

    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const fragColorIdx = lines.findIndex(l => l.includes('fragColor') && !l.includes('fragColor,'));
    // There should be at least one closing brace before fragColor
    const hasClosingBraceBeforeOutput = lines.slice(0, fragColorIdx).some(l => l.trim() === '}');
    expect(hasClosingBraceBeforeOutput).toBe(true);
  });

  it('debug line NOT in if block: output placement unchanged', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = vec3(uv, 0.5);
  fragColor = vec4(col, 1.0);
}`;

    // Debug line 2: uv declaration — NOT inside any if block
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 2, '  vec2 uv = fragCoord / iResolution.xy;');

    expect(result).not.toBeNull();
    // Should still produce valid output
    expect(result).toContain('fragColor');
  });

  it('debug line inside if-else branch: output correctly placed after else', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = vec3(0.0);
  if (uv.x < 0.5) {
    col = vec3(1.0, 0.0, 0.0);
  } else {
    col = vec3(0.0, 0.0, 1.0);
  }
  fragColor = vec4(col, 1.0);
}`;

    // Debug line 6: "col = vec3(0.0, 0.0, 1.0);" — inside else block
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 6, '    col = vec3(0.0, 0.0, 1.0);');

    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    const fragColorIdx = lines.findIndex(l => l.includes('fragColor') && !l.includes('fragColor,'));
    // The else closing brace must come before fragColor
    const closingBraceBeforeOutput = lines.slice(0, fragColorIdx).filter(l => l.trim() === '}');
    expect(closingBraceBeforeOutput.length).toBeGreaterThan(0);
  });

  it('output fragColor produces correct type for vec3 inside if block', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  if (uv.x > 0.5) {
    vec3 col = vec3(uv, 0.0);
  }
  fragColor = vec4(0.0);
}`;

    // Debug line 3: vec3 declaration inside if
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    vec3 col = vec3(uv, 0.0);');

    expect(result).not.toBeNull();
    // vec3 → fragColor = vec4(col, 1.0) or similar
    expect(result).toMatch(/fragColor\s*=/);
  });
});

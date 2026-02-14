import { describe, it, expect } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Debug Truncation', () => {
  it('should investigate line truncation bug', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;
}`;

    const manager = new ShaderDebugManager();
    manager.toggleEnabled();
    manager.updateDebugLine(3, '  uv.x *= iResolution.x / iResolution.y;', 'test.glsl');

    // Manually check what modifyShaderForDebugging does
    const lines = shader.split('\n');

    console.log('=== LINE INVESTIGATION ===');
    console.log('Total lines:', lines.length);
    lines.forEach((line, i) => {
      console.log(`Line ${i}: "${line}"`);
    });

    const adjustedLine = 3;
    console.log(`\nSlicing from 0 to ${adjustedLine + 1}`);
    const truncatedLines = lines.slice(0, adjustedLine + 1);
    console.log('Truncated lines count:', truncatedLines.length);
    truncatedLines.forEach((line, i) => {
      console.log(`Truncated[${i}]: "${line}"`);
    });

    const result = manager.modifyShaderForDebugging(shader, 3, 0);
    console.log('\n=== ACTUAL RESULT ===');
    console.log(result);
    console.log('======================');

    expect(result).not.toBeNull();
    if (result) {
      // Check if vec2 uv line is included
      const hasUvDeclaration = result.includes('vec2 uv = -1. + 2. * fragCoord');
      console.log('\nHas uv declaration:', hasUvDeclaration);

      expect(hasUvDeclaration).toBe(true);
    }
  });
});

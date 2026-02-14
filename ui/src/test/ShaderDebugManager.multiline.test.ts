import { describe, it, expect } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Multi-line UV reassignment', () => {
  it('should detect plain reassignment on line 3', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord/iResolution.xy;
  uv = fragCoord/iResolution.xy * 2.0 - 1.0;
  uv.y += 0.9;
}`;

    const manager = new ShaderDebugManager();
    manager.toggleEnabled();

    // Test line 3: plain reassignment
    manager.updateDebugLine(3, '  uv = fragCoord/iResolution.xy * 2.0 - 1.0;', 'test.glsl');

    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== LINE 3 TEST (plain reassignment) ===');
    console.log('Input line:', '  uv = fragCoord/iResolution.xy * 2.0 - 1.0;');
    console.log('Result:', result);
    console.log('=========================================\n');

    expect(result).not.toBeNull();
    if (result) {
      // Should include both line 1 (vec2 uv declaration) and line 2 (reassignment)
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('uv = fragCoord/iResolution.xy * 2.0 - 1.0');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('should detect member access on line 4', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord/iResolution.xy;
  uv = fragCoord/iResolution.xy * 2.0 - 1.0;
  uv.y += 0.9;
}`;

    const manager = new ShaderDebugManager();
    manager.toggleEnabled();

    // Test line 4: member access
    manager.updateDebugLine(4, '  uv.y += 0.9;', 'test.glsl');

    const result = manager.modifyShaderForDebugging(shader, 4, 0);

    console.log('\n=== LINE 4 TEST (member access) ===');
    console.log('Input line:', '  uv.y += 0.9;');
    console.log('Result:', result);
    console.log('====================================\n');

    expect(result).not.toBeNull();
    if (result) {
      // Should include all 3 lines
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('uv = fragCoord/iResolution.xy * 2.0 - 1.0');
      expect(result).toContain('uv.y += 0.9');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });
});

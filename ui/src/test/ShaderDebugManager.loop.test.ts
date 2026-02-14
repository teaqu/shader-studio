import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Loop Handling', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

  it('should extract loop initialization and run body once', () => {
    const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  for (int i = 0; i < 10; i++) {
    float x = float(i) * 0.1;
    uv.x += x;
  }

  fragColor = vec4(uv, 0.0, 1.0);
}`;

    manager.updateDebugLine(4, '    float x = float(i) * 0.1;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 4, 0);

    console.log('\n=== LOOP: Debug line inside for loop ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should extract loop initialization
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');

      // Should NOT contain the for loop line
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');

      // Should include the debug line
      expect(result).toContain('float x = float(i) * 0.1');

      // Should visualize the float using variable name directly
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

    manager.updateDebugLine(5, '      float val = float(i + j);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 5, 0);

    console.log('\n=== NESTED LOOPS: Debug line inside nested for loops ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should extract both loop initializations
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).toContain('int j = 0;  // Loop init (first iteration only)');

      // Should NOT contain the for loop lines
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');
      expect(result).not.toContain('for (int j = 0; j < 5; j++)');

      // Should include the debug line
      expect(result).toContain('float val = float(i + j)');

      // Should visualize the float using variable name directly
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

    manager.updateDebugLine(5, '    float x = float(i) * 0.1;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 5, 0);

    console.log('\n=== LOOP: For loop with pre-declared variable ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should extract loop initialization (just assignment, no declaration)
      expect(result).toContain('i = 0;  // Loop init (first iteration only)');

      // Should NOT contain the for loop line
      expect(result).not.toContain('for (i = 0; i < 10; i++)');

      // Should include the debug line
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

    manager.updateDebugLine(4, '    vec3 color = vec3(t);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 4, 0);

    console.log('\n=== LOOP: Float loop variable ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should extract loop initialization with float
      expect(result).toContain('float t = 0.0;  // Loop init (first iteration only)');

      // Should include the debug line
      expect(result).toContain('vec3 color = vec3(t)');

      // Should visualize the vec3 using variable name directly
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

    manager.updateDebugLine(4, '    float x = float(i);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 4, 0);

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

    manager.updateDebugLine(5, '    float x = float(i);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 5, 0);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('int i = 0;  // Loop init (first iteration only)');
      expect(result).not.toContain('for (int i = 0; i < 10; i++)');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

const SHADER = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float myVar = uv.x;
  float other = myVar * 2.0;
  fragColor = vec4(other);
}`;

describe('ShaderDebugger - variable preview', () => {
  it('visualizes an explicitly requested variable', () => {
    const result = ShaderDebugger.modifyShaderForVariablePreview(
      SHADER,
      3,
      { name: 'myVar', type: 'float' },
    );

    expect(result).not.toBeNull();
    expect(result).toContain('float other = myVar * 2.0;');
    expect(result).toContain('fragColor = vec4(vec3(myVar), 1.0);');
    expect(result).not.toContain('fragColor = vec4(vec3(other), 1.0);');
  });

  it('returns null when explicit variable is not in scope', () => {
    const result = ShaderDebugger.modifyShaderForVariablePreview(
      SHADER,
      3,
      { name: 'nonExistent', type: 'float' },
    );

    expect(result).toBeNull();
  });
});

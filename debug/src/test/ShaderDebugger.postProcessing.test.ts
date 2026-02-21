import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';
import { CodeGenerator } from '../CodeGenerator';

const basicShader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}
`.trim();

describe('ShaderDebugger.applyFullShaderPostProcessing', () => {
  it('should return null when normalize is off and no step', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'off', null);
    expect(result).toBeNull();
  });

  it('should apply soft normalization', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'soft', null);
    expect(result).not.toBeNull();
    expect(result).toContain('fragColor.rgb');
    expect(result).toContain('0.5');
  });

  it('should apply abs normalization', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'abs', null);
    expect(result).not.toBeNull();
    expect(result).toContain('abs(fragColor.rgb)');
  });

  it('should apply step threshold', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'off', 0.5);
    expect(result).not.toBeNull();
    expect(result).toContain('step');
    expect(result).toContain('0.5');
  });

  it('should apply both normalization and step', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'soft', 0.3);
    expect(result).not.toBeNull();
    expect(result).toContain('0.5'); // soft normalization
    expect(result).toContain('step'); // step threshold
  });

  it('should preserve original shader structure', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'soft', null);
    expect(result).not.toBeNull();
    expect(result).toContain('void mainImage');
    expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
  });

  it('should delegate to CodeGenerator.applyOutputPostProcessing', () => {
    const debuggerResult = ShaderDebugger.applyFullShaderPostProcessing(basicShader, 'abs', 0.5);
    const codeGenResult = CodeGenerator.applyOutputPostProcessing(basicShader, 'abs', 0.5);
    expect(debuggerResult).toBe(codeGenResult);
  });
});

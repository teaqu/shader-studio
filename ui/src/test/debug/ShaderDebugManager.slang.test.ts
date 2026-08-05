import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

const slangShader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(uv, 0.5);
    col += float3(0.1);
    return float4(col, 1.0);
}`;

describe('ShaderDebugManager - Slang language mode', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.setLanguage('slang');
    manager.setImageShaderCode(slangShader);
  });

  it('defaults to glsl language', () => {
    expect(new ShaderDebugManager().getLanguage()).toBe('glsl');
  });

  it('stores the configured language', () => {
    expect(manager.getLanguage()).toBe('slang');
  });

  it('generates Slang debug output for line debugging', () => {
    manager.toggleEnabled();
    manager.updateDebugLine(3, '    float3 col = float3(uv, 0.5);', 'flow.slang');

    const result = manager.modifyShaderForDebugging(slangShader, 3);

    expect(result).not.toBeNull();
    expect(result).toContain('return float4(col, 1.0);');
    expect(result).not.toContain('fragColor =');
    expect(result).not.toContain('vec4(');
  });

  it('generates GLSL debug output when language is glsl', () => {
    const glslManager = new ShaderDebugManager();
    const glslShader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = vec3(uv, 0.5);
  fragColor = vec4(col, 1.0);
}`;
    glslManager.setImageShaderCode(glslShader);
    glslManager.toggleEnabled();
    glslManager.updateDebugLine(2, '  vec3 col = vec3(uv, 0.5);', 'shader.glsl');

    const result = glslManager.modifyShaderForDebugging(glslShader, 2);

    expect(result).not.toBeNull();
    expect(result).toContain('fragColor = vec4(col, 1.0);');
  });

  it('applies Slang full-shader post-processing', () => {
    manager.setNormalizeMode('soft');

    const result = manager.applyFullShaderPostProcessing(slangShader);

    expect(result).not.toBeNull();
    expect(result).toContain('_dbgUserMain');
    expect(result).toContain('float4 mainImage(float2 fragCoord)');
    expect(result).not.toContain('vec3(');
  });

  it('extracts Slang function context on debug line updates', () => {
    manager.toggleEnabled();
    manager.updateDebugLine(3, '    float3 col = float3(uv, 0.5);', 'flow.slang');

    const context = manager.getState().functionContext;

    expect(context).not.toBeNull();
    expect(context!.functionName).toBe('mainImage');
    expect(context!.returnType).toBe('float4');
  });

  it('generates Slang output for variable previews', () => {
    manager.toggleEnabled();
    manager.updateDebugLine(4, '    col += float3(0.1);', 'flow.slang');
    manager.setVariablePreview({
      varName: 'col',
      varType: 'float3',
      debugLine: 4,
      activeBufferName: 'Image',
      filePath: 'flow.slang',
    });

    const result = manager.modifyShaderForDebugging(slangShader, 4);

    expect(result).not.toBeNull();
    expect(result).toContain('return float4(col, 1.0);');
    expect(result).not.toContain('vec4(');
  });

  it('uses writable Slang storage when previewing an earlier local in an imported standalone helper', () => {
    const source = `#language slang 2026
module debugpalette;
import debugmath;

public float3 debugPalette(float phase)
{
    float blend = debugWave(phase);
    float3 coolColor = float3(0.03, 0.22, 1.0);
    float3 warmColor = float3(1.0, 0.12, 0.38);
    float3 color = lerp(coolColor, warmColor, blend);
    return color;
}`;
    manager.setImageShaderCode(source);
    manager.setShaderContext(null, '/debugpalette.slang', {}, [{
      moduleName: 'debugmath',
      path: '/debugmath.slang',
      source: 'module debugmath; public float debugWave(float phase) { return sin(phase); }',
      ownerPass: 'Image',
    }]);
    manager.toggleEnabled();
    manager.updateDebugLine(10, '    return color;', '/debugpalette.slang');

    expect(manager.setVariablePreview({
      varName: 'blend',
      varType: 'float',
      debugLine: 10,
      activeBufferName: 'Image',
      filePath: '/debugpalette.slang',
    })).toBe(true);

    const target = manager.getDebugTarget(source, null);
    const result = manager.modifyShaderForDebugging(target.code, 10);

    expect(target.slangModules).toHaveLength(1);
    expect(result).toContain('static float _dbgCaptured;');
    expect(result).toContain('return float4(float3(_dbgCaptured), 1.0);');
  });
});

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

  it('refuses to instrument an imported module instead of applying its line to the root', () => {
    const workspace = {
      rootUri: 'file:///project',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: slangShader },
        { uri: 'file:///project/palette.slang', path: '/workspace/palette.slang', source: 'module palette;\nfloat3 palette(float x) { return x.xxx; }' },
      ],
    };
    manager.setShaderContext(null, '/project/image.slang', {}, workspace);
    manager.toggleEnabled();
    manager.updateDebugLine(1, 'float3 palette(float x) { return x.xxx; }', '/project/palette.slang');

    const result = manager.modifyShaderForDebugging(slangShader, 1);

    expect(result).toBeNull();
    expect(manager.getState().debugDiagnostic).toMatchObject({
      code: 'slang-cross-file-debug-unsupported',
      sourceUri: 'file:///project/palette.slang',
      passName: 'Image',
      range: { start: { line: 1, character: 0 } },
    });
    expect(manager.getState().debugError).toMatch(/imported Slang modules/i);
  });

  it('allows root instrumentation when a workspace contains imported modules', () => {
    const workspace = {
      rootUri: 'file:///project',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: slangShader },
        { uri: 'file:///project/palette.slang', path: '/workspace/palette.slang', source: 'module palette;' },
      ],
    };
    manager.setShaderContext(null, '/project/image.slang', {}, workspace);
    manager.toggleEnabled();
    manager.updateDebugLine(3, '    float3 col = float3(uv, 0.5);', '/project/image.slang');

    const result = manager.modifyShaderForDebugging(slangShader, 3);

    expect(result).toContain('return float4(col, 1.0);');
    expect(manager.getState().debugDiagnostic).toBeNull();
  });

  it('refuses to treat a configured common module as the Image root', () => {
    const common = 'float3 helper(float x) {\n  float3 value = x.xxx;\n  return value;\n}';
    const workspace = {
      rootUri: 'file:///project',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: slangShader },
        { uri: 'file:///project/common.slang', path: '/workspace/common.slang', source: common },
      ],
    };
    manager.setShaderContext({
      version: '1',
      passes: {
        Image: { inputs: {} },
        common: { path: 'common.slang' },
      },
    }, '/project/image.slang', { common }, workspace);
    manager.toggleEnabled();
    manager.updateDebugLine(1, '  float3 value = x.xxx;', '/project/common.slang');

    expect(manager.modifyShaderForDebugging(common, 1)).toBeNull();
    expect(manager.getState().debugDiagnostic).toMatchObject({
      code: 'slang-cross-file-debug-unsupported',
      sourceUri: 'file:///project/common.slang',
      passName: 'common',
    });
  });

  it('canonicalizes Windows paths and escaped URI spaces before rejecting imported modules', () => {
    const workspace = {
      rootUri: 'file:///C:/Project',
      files: [
        { uri: 'file:///C:/Project/image.slang', path: '/workspace/image.slang', source: slangShader },
        { uri: 'file:///C:/Project/Helper%20File.slang', path: '/workspace/Helper File.slang', source: 'float helper = 1;' },
      ],
    };
    manager.setShaderContext(null, 'C:\\PROJECT\\image.slang', {}, workspace);
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float helper = 1;', 'c:\\project\\helper file.slang');

    expect(manager.modifyShaderForDebugging(slangShader, 0)).toBeNull();
    expect(manager.getState().debugDiagnostic?.sourceUri).toBe('file:///C:/Project/Helper%20File.slang');
  });

  it('fails safe when the selected Slang source cannot be resolved', () => {
    manager.setShaderContext(null, '/project/image.slang', {}, {
      rootUri: 'file:///project',
      files: [{ uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: slangShader }],
    });
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'unknown', '/outside/unknown.slang');

    expect(manager.modifyShaderForDebugging(slangShader, 0)).toBeNull();
    expect(manager.getState().debugDiagnostic).toMatchObject({
      sourceUri: '/outside/unknown.slang',
      code: 'slang-cross-file-debug-unsupported',
    });
  });

  it('owns its workspace snapshot after shader context is set', () => {
    const workspace = {
      rootUri: 'file:///project',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: slangShader },
        { uri: 'file:///project/helper.slang', path: '/workspace/helper.slang', source: 'float helper = 1;' },
      ],
    };
    manager.setShaderContext(null, '/project/image.slang', {}, workspace);
    workspace.files[1].uri = 'file:///project/mutated.slang';
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float helper = 1;', '/project/helper.slang');

    expect(manager.modifyShaderForDebugging(slangShader, 0)).toBeNull();
    expect(manager.getState().debugDiagnostic?.sourceUri).toBe('file:///project/helper.slang');
  });
});

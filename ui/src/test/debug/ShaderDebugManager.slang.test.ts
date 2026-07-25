import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('rejects debugging an imported Slang module without changing the root target', () => {
    const root = '#language slang 2026\nmodule image;\nimport palette;\nfloat4 mainImage(float2 p) { return float4(paletteValue(), 0, 0, 1); }';
    manager.setShaderContext(
      { version: '1', passes: { Image: {} } },
      '/workspace/image.slang',
      {},
      {
        rootUri: 'file:///project/image.slang',
        files: [
          { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: root },
          { uri: 'file:///project/lib/palette.slang', path: '/workspace/lib/palette.slang', source: 'module palette;' },
        ],
      },
    );
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float value = 1;', 'file:///project/lib/palette.slang');

    expect(manager.getDebugTarget(root, { version: '1', passes: { Image: {} } })).toMatchObject({
      status: 'unsupported',
      code: 'slang-cross-file-debug-unsupported',
      sourceUri: 'file:///project/lib/palette.slang',
    });
  });

  it('rejects debugging configured Slang common code', () => {
    const root = '#language slang 2026\nmodule image;\nfloat4 mainImage(float2 p) { return float4(p, 0, 1); }';
    manager.setShaderContext(
      { version: '1', passes: { Image: {} } },
      '/workspace/image.slang',
      { common: 'float commonValue() { return 1; }' },
      {
        rootUri: 'file:///project/image.slang',
        files: [
          { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: root },
          { uri: 'file:///project/common.slang', path: '/workspace/common.slang', source: 'float commonValue() { return 1; }' },
        ],
      },
    );
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float commonValue() { return 1; }', 'file:///project/common.slang');

    expect(manager.getDebugTarget(root, { version: '1', passes: { Image: {} } })).toMatchObject({
      status: 'unsupported',
      code: 'slang-cross-file-debug-unsupported',
      sourceUri: 'file:///project/common.slang',
    });
  });

  it.each([
    ['unmatched', 'file:///project/lib/missing.slang'],
    ['ambiguous', 'palette.slang'],
  ])('rejects an %s Slang selection instead of assuming the workspace root', (_kind, selector) => {
    const root = '#language slang 2026\nmodule image;\nfloat4 mainImage(float2 p) { return float4(p, 0, 1); }';
    manager.setShaderContext({ version: '1', passes: { Image: {} } }, '/workspace/image.slang', {}, {
      rootUri: 'file:///project/image.slang',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: root },
        { uri: 'file:///project/a/palette.slang', path: '/workspace/a/palette.slang', source: '' },
        { uri: 'file:///project/b/palette.slang', path: '/workspace/b/palette.slang', source: '' },
      ],
    });
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float value = 1;', selector);

    expect(manager.getDebugTarget(root, { version: '1', passes: { Image: {} } })).toMatchObject({
      status: 'unsupported', code: 'slang-cross-file-debug-unsupported', sourceUri: selector,
    });
  });

  it('rejects an unmatched active Slang root selector even when the selected file is the workspace root', () => {
    const root = '#language slang 2026\nmodule image;\nfloat4 mainImage(float2 p) { return float4(p, 0, 1); }';
    manager.setShaderContext({ version: '1', passes: { Image: {} } }, '/workspace/missing.slang', {}, {
      rootUri: 'file:///project/image.slang',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: root },
      ],
    });
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float value = 1;', 'file:///project/image.slang');

    expect(manager.getDebugTarget(root, { version: '1', passes: { Image: {} } })).toMatchObject({
      status: 'unsupported', code: 'slang-cross-file-debug-unsupported', sourceUri: 'file:///project/image.slang',
    });
  });

  it('rejects an ambiguous active Slang root selector', () => {
    const root = '#language slang 2026\nmodule image;\nfloat4 mainImage(float2 p) { return float4(p, 0, 1); }';
    manager.setShaderContext({ version: '1', passes: { Image: {} } }, 'image.slang', {}, {
      rootUri: 'file:///project/image.slang',
      files: [
        { uri: 'file:///project/a/image.slang', path: '/workspace/a/image.slang', source: root },
        { uri: 'file:///project/b/image.slang', path: '/workspace/b/image.slang', source: root },
      ],
    });
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float value = 1;', 'file:///project/a/image.slang');

    expect(manager.getDebugTarget(root, { version: '1', passes: { Image: {} } })).toMatchObject({
      status: 'unsupported', code: 'slang-cross-file-debug-unsupported', sourceUri: 'file:///project/a/image.slang',
    });
  });

  it('rejects configured common code even when it is absent from the workspace snapshot', () => {
    const root = '#language slang 2026\nmodule image;\nfloat4 mainImage(float2 p) { return float4(p, 0, 1); }';
    manager.setShaderContext({ version: '1', passes: { Image: {} } }, '/workspace/image.slang', { common: 'float commonValue() { return 1; }' }, {
      rootUri: 'file:///project/image.slang',
      files: [{ uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: root }],
    });
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float commonValue() { return 1; }', 'file:///project/common.slang');

    expect(manager.getDebugTarget(root, { version: '1', passes: { Image: {} } })).toMatchObject({
      status: 'unsupported', code: 'slang-cross-file-debug-unsupported', sourceUri: 'file:///project/common.slang',
    });
  });

  it('publishes a cross-file notice once and clears only that notice when the root resumes', () => {
    const root = '#language slang 2026\nmodule image;\nfloat4 mainImage(float2 p) { return float4(p, 0, 1); }';
    manager.setShaderContext({ version: '1', passes: { Image: {} } }, '/workspace/image.slang', {}, {
      rootUri: 'file:///project/image.slang',
      files: [
        { uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: root },
        { uri: 'file:///project/palette.slang', path: '/workspace/palette.slang', source: 'module palette;' },
      ],
    });
    manager.toggleEnabled();
    manager.updateDebugLine(0, 'float value = 1;', 'file:///project/palette.slang');
    const unsupported = manager.getDebugTarget(root, { version: '1', passes: { Image: {} } });
    expect(unsupported).toMatchObject({ status: 'unsupported' });
    if (!('status' in unsupported)) {
      throw new Error('expected unsupported target');
    }
    const callback = vi.fn();
    manager.setStateCallback(callback);

    manager.reportSlangCrossFileDebugUnsupported(unsupported);
    manager.reportSlangCrossFileDebugUnsupported(unsupported);

    expect(manager.getState().debugNotice).toBe(unsupported.message);
    expect(callback).toHaveBeenCalledTimes(1);

    manager.clearSlangCrossFileDebugUnsupported();
    expect(manager.getState().debugNotice).toBeNull();

    manager.reportSlangCrossFileDebugUnsupported(unsupported);
    manager.modifyShaderForDebugging('not a shader', 0);
    expect(manager.getState().debugNotice).toBe('No debuggable variable on this line');
    manager.clearSlangCrossFileDebugUnsupported();
    expect(manager.getState().debugNotice).toBe('No debuggable variable on this line');
  });
});

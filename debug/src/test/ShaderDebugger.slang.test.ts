import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

// Slang image shaders follow the WebGPU pipeline convention:
//   float4 mainImage(float2 fragCoord) { ... return float4(...); }
// Debug output must be emitted as a `return float4(...)` statement in Slang
// (there is no `out vec4 fragColor` parameter like GLSL).

const slangShader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;
    float3 sharp = sampleIChannel0(uv).rgb;
    col += sharp;
    if (uv.y > 0.985) col = float3(1.0, 0.0, 0.0);
    return float4(col, 1.0);
}`;

describe('ShaderDebugger - Slang line debug in mainImage', () => {
  it('preserves BOM, language/module headers, imports, and their line positions', () => {
    const source = `\uFEFF#language slang 2026\nmodule image;\nimport palette;\n#include "common.slang"\n${slangShader}`;
    const result = ShaderDebugger.modifyShaderForLineDebug(
      source, 7, '    float3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;',
      new Map(), new Map(), 'off', null, 'slang',
    );

    expect(result?.split('\n').slice(0, 4)).toEqual([
      '\uFEFF#language slang 2026',
      'module image;',
      'import palette;',
      '#include "common.slang"',
    ]);
  });
  it('visualizes a float3 declaration with a return statement', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      slangShader,
      3,
      '    float3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('return float4(col, 1.0);');
    // Truncated: later statements must be gone
    expect(result).not.toContain('sharp');
    // No GLSL leakage
    expect(result).not.toContain('fragColor =');
    expect(result).not.toContain('vec4(');
  });

  it('visualizes a float2 variable in RG channels', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      slangShader,
      2,
      '    float2 uv = fragCoord / iResolution.xy;',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('return float4(uv, 0.0, 1.0);');
    expect(result).not.toContain('vec4(');
  });

  it('visualizes a float variable as grayscale', () => {
    const shader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float d = uv.x * 0.5;
    return float4(d, d, d, 1.0);
}`;
    const result = ShaderDebugger.modifyShaderForLineDebug(
      shader,
      3,
      '    float d = uv.x * 0.5;',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('return float4(float3(d), 1.0);');
  });

  it('visualizes an assignment to an existing float3', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      slangShader,
      5,
      '    col += sharp;',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('col += sharp;');
    expect(result).toContain('return float4(col, 1.0);');
  });

  it('handles debugging the return line via _dbgReturn', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      slangShader,
      7,
      '    return float4(col, 1.0);',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('float4 _dbgReturn = float4(col, 1.0);');
    expect(result).toContain('return _dbgReturn;');
  });

  it('applies soft normalization to a float3', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      slangShader,
      3,
      '    float3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;',
      new Map(),
      new Map(),
      'soft',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('(col / (abs(col) + float3(1.0)) * 0.5 + 0.5)');
    expect(result).not.toContain('vec3(');
  });

  it('applies step threshold via a temporary output variable', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      slangShader,
      3,
      '    float3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;',
      new Map(),
      new Map(),
      'off',
      0.5,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('float4 _dbgOut = float4(col, 1.0);');
    expect(result).toContain('_dbgOut = float4(step(float3(0.5000), _dbgOut.rgb), 1.0);');
    expect(result).toContain('return _dbgOut;');
  });

  it('inserts a shadow variable for a debug line inside a loop', () => {
    const shader = `float4 mainImage(float2 fragCoord)
{
    float3 col = float3(0.0);
    for (int i = 0; i < 8; i++) {
        col += float3(0.1);
    }
    return float4(col, 1.0);
}`;
    const result = ShaderDebugger.modifyShaderForLineDebug(
      shader,
      4,
      '        col += float3(0.1);',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('float3 _dbgShadow;');
    expect(result).toContain('_dbgShadow = col;');
    expect(result).toContain('return float4(_dbgShadow, 1.0);');
  });
});

describe('ShaderDebugger - Slang helper function debug', () => {
  const shaderWithHelper = `float3 palette(float t)
{
    float3 res = float3(t, t * 0.5, 1.0 - t);
    return res;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = palette(uv.x);
    return float4(col, 1.0);
}`;

  it('wraps a helper function and visualizes a local variable', () => {
    const result = ShaderDebugger.modifyShaderForLineDebug(
      shaderWithHelper,
      2,
      '    float3 res = float3(t, t * 0.5, 1.0 - t);',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    // Slang-style generated mainImage wrapper
    expect(result).toContain('float4 mainImage(float2 fragCoord)');
    expect(result).toContain('_dbg_palette');
    expect(result).toContain('return float4(result, 1.0);');
    expect(result).not.toContain('out vec4 fragColor');
  });

  it('keeps float2 parameters seeded from uv in the wrapper', () => {
    const shader = `float3 field(float2 p)
{
    float3 v = float3(p, 0.0);
    return v;
}

float4 mainImage(float2 fragCoord)
{
    return float4(field(fragCoord / iResolution.xy), 1.0);
}`;
    const result = ShaderDebugger.modifyShaderForLineDebug(
      shader,
      2,
      '    float3 v = float3(p, 0.0);',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('float2 uv = fragCoord / iResolution.xy;');
    expect(result).not.toContain('vec2 uv');
  });

  it('wraps a public helper in a standalone module without mainImage', () => {
    const shader = `#language slang 2026
module debugmath;

public float debugWave(float phase)
{
    float accumulated = sin(phase);
    return accumulated;
}`;

    const result = ShaderDebugger.modifyShaderForLineDebug(
      shader,
      5,
      '    float accumulated = sin(phase);',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('public float _dbg_debugWave(float phase)');
    expect(result).toContain('float4 mainImage(float2 fragCoord)');
    expect(result).toContain('float result = _dbg_debugWave(0.5);');
    expect(result!.match(/public float debugWave\(float phase\)/g)).toHaveLength(1);
  });

  it('renders the return value from the opening brace of a public standalone helper', () => {
    const shader = `#language slang 2026
module debugmath;

public float debugWave(float phase)
{
    float accumulated = sin(phase);
    return accumulated;
}`;

    const result = ShaderDebugger.modifyShaderForLineDebug(
      shader,
      4,
      '{',
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('public float _dbg_debugWave(float phase)');
    expect(result).toContain('float4 mainImage(float2 fragCoord)');
    expect(result).toContain('float result = _dbg_debugWave(0.5);');
  });
});

describe('ShaderDebugger - Slang full-shader post-processing', () => {
  it('wraps mainImage and applies soft normalization', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(slangShader, 'soft', null, 'slang');

    expect(result).not.toBeNull();
    expect(result).toContain('_dbgUserMain');
    expect(result).toContain('float4 mainImage(float2 fragCoord)');
    expect(result).toContain('float4 fragColor = _dbgUserMain(fragCoord);');
    expect(result).toContain('fragColor.rgb = fragColor.rgb / (abs(fragColor.rgb) + float3(1.0)) * 0.5 + 0.5;');
    expect(result).toContain('return fragColor;');
  });

  it('applies step threshold to the final output', () => {
    const result = ShaderDebugger.applyFullShaderPostProcessing(slangShader, 'off', 0.25, 'slang');

    expect(result).not.toBeNull();
    expect(result).toContain('fragColor = float4(step(float3(0.2500), fragColor.rgb), 1.0);');
  });

  it('returns null when no post-processing is requested', () => {
    expect(ShaderDebugger.applyFullShaderPostProcessing(slangShader, 'off', null, 'slang')).toBeNull();
  });
});

describe('ShaderDebugger - Slang variable preview', () => {
  it('visualizes an explicitly requested variable', () => {
    const result = ShaderDebugger.modifyShaderForVariablePreview(
      slangShader,
      5,
      { name: 'col', type: 'float3' },
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('return float4(col, 1.0);');
  });

  it('returns null for an out-of-scope variable', () => {
    const result = ShaderDebugger.modifyShaderForVariablePreview(
      slangShader,
      2,
      { name: 'nosuch', type: 'float3' },
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).toBeNull();
  });

  it('replaces the original mainImage return when previewing another local from that line', () => {
    const shader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float held = uv.x > 0.5 ? 1.0 : 0.0;
    float3 color = float3(uv, 0.0);
    return float4(color, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForVariablePreview(
      shader,
      5,
      { name: 'held', type: 'float' },
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).not.toContain('return float4(color, 1.0);');
    expect(result).toContain('return float4(float3(held), 1.0);');
  });

  it('previews a local from an imported public helper without mainImage', () => {
    const shader = `#language slang 2026
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

    const result = ShaderDebugger.modifyShaderForVariablePreview(
      shader,
      10,
      { name: 'blend', type: 'float' },
      new Map(),
      new Map(),
      'off',
      null,
      'slang',
    );

    expect(result).not.toBeNull();
    expect(result).toContain('import debugmath;');
    expect(result).toContain('static float _dbgCaptured;');
    expect(result).toContain('public float3 _dbg_debugPalette(float phase)');
    expect(result).toContain('float4 mainImage(float2 fragCoord)');
    expect(result).toContain('return float4(float3(_dbgCaptured), 1.0);');
  });
});

describe('ShaderDebugger - Slang function context extraction', () => {
  it('extracts Slang return type and parameters', () => {
    const shader = `float3 palette(float t)
{
    float3 res = float3(t, t * 0.5, 1.0 - t);
    return res;
}`;
    const context = ShaderDebugger.extractFunctionContext(shader, 2, 'slang');

    expect(context).not.toBeNull();
    expect(context!.functionName).toBe('palette');
    expect(context!.returnType).toBe('float3');
    expect(context!.parameters).toHaveLength(1);
    expect(context!.parameters[0].name).toBe('t');
    expect(context!.parameters[0].type).toBe('float');
  });

  it('extracts the return type after a public modifier', () => {
    const shader = `public float debugWave(float phase)
{
    return sin(phase);
}`;
    const context = ShaderDebugger.extractFunctionContext(shader, 2, 'slang');

    expect(context?.functionName).toBe('debugWave');
    expect(context?.returnType).toBe('float');
  });

  it('uses Slang constructors for parameter defaults', () => {
    const shader = `float3 field(float3 p)
{
    float3 v = p * 2.0;
    return v;
}`;
    const context = ShaderDebugger.extractFunctionContext(shader, 2, 'slang');

    expect(context).not.toBeNull();
    expect(context!.parameters[0].uvValue).toBe('float3(uv, 0.0)');
    expect(context!.parameters[0].defaultExpression).toBe('float3(0.5)');
  });
});

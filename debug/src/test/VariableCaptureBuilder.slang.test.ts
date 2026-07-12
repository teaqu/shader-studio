import { describe, it, expect } from 'vitest';
import { VariableCaptureBuilder } from '../VariableCaptureBuilder';

// Slang capture shaders differ from GLSL:
// - no `uniform ...` declarations (the WebGPU capture prelude provides
//   `_dbgVarIndex` / capture coordinates and calls mainImage with the
//   already-remapped fragCoord, since Slang parameters are immutable)
// - selector branches `return float4(...)` instead of assigning fragColor
// - module-scope capture slots must be `static` to be writable

const slangShader = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(uv, 0.5);
    float glow = uv.x * 2.0;
    return float4(col, 1.0);
}`;

describe('VariableCaptureBuilder - Slang in-scope variables', () => {
  it('finds Slang-typed variables in mainImage', () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(slangShader, 4);

    const names = vars.map(v => v.varName);
    expect(names).toContain('uv');
    expect(names).toContain('col');
    expect(names).toContain('glow');
    expect(vars.find(v => v.varName === 'uv')!.varType).toBe('float2');
    expect(vars.find(v => v.varName === 'col')!.varType).toBe('float3');
  });

  it('adds _dbgReturn for a Slang return line', () => {
    const vars = VariableCaptureBuilder.getAllInScopeVariables(slangShader, 5);
    const ret = vars.find(v => v.varName === '_dbgReturn');
    expect(ret).toBeDefined();
    expect(ret!.varType).toBe('float4');
  });
});

describe('VariableCaptureBuilder - Slang multi-capture shader (mainImage scope)', () => {
  const vars = [
    { varName: 'uv', varType: 'float2', declarationLine: 2 },
    { varName: 'col', varType: 'float3', declarationLine: 3 },
  ];

  it('generates selector branches that return float4 values', () => {
    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      slangShader, 4, vars, new Map(), new Map(), false, 32, 32, 'slang',
    );

    expect(shader).not.toBeNull();
    expect(shader).toContain('if (_dbgVarIndex == 0)');
    expect(shader).toContain('return float4(uv, 0.0, 0.0);');
    expect(shader).toContain('if (_dbgVarIndex == 1)');
    expect(shader).toContain('return float4(col, 0.0);');
    // Fallback for unmatched selector
    expect(shader).toContain('return float4(0.0);');
  });

  it('does not emit GLSL uniform declarations or fragCoord mutation', () => {
    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      slangShader, 4, vars, new Map(), new Map(), true, 32, 32, 'slang',
    );

    expect(shader).not.toBeNull();
    expect(shader).not.toContain('uniform ');
    expect(shader).not.toContain('fragCoord =');
    expect(shader).not.toContain('gl_FragCoord');
    expect(shader).not.toContain('vec4(');
  });

  it('keeps the Slang mainImage signature for the capture prelude to call', () => {
    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      slangShader, 4, vars, new Map(), new Map(), false, 32, 32, 'slang',
    );

    expect(shader).toContain('float4 mainImage(float2 fragCoord)');
  });
});

describe('VariableCaptureBuilder - Slang multi-capture shader (helper function scope)', () => {
  const helperShader = `float3 palette(float t)
{
    float3 res = float3(t, t * 0.5, 1.0 - t);
    return res;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(palette(uv.x), 1.0);
}`;

  it('captures helper locals through static module-scope slots', () => {
    const vars = [{ varName: 'res', varType: 'float3', declarationLine: 2 }];
    const shader = VariableCaptureBuilder.generateMultiCaptureShader(
      helperShader, 2, vars, new Map(), new Map(), false, 32, 32, 'slang',
    );

    expect(shader).not.toBeNull();
    expect(shader).toContain('static float3 _dbgCaptured0;');
    expect(shader).toContain('_dbg_palette');
    expect(shader).toContain('float4 mainImage(float2 fragCoord)');
    expect(shader).toContain('return float4(_dbgCaptured0, 0.0);');
    expect(shader).not.toContain('uniform ');
    expect(shader).not.toContain('out vec4 fragColor');
  });
});

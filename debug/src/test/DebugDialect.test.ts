import { describe, expect, it } from 'vitest';
import { getDebugDialect } from '../dialects';

describe('debug dialect adapters', () => {
  it('emits GLSL capture scaffolding without Slang/WebGPU details', () => {
    const dialect = getDebugDialect('glsl');

    expect(dialect.name).toBe('glsl');
    expect(dialect.mainImagePattern.test('void mainImage(out vec4 fragColor, in vec2 fragCoord)')).toBe(true);
    expect(dialect.mainImageWrapperOpen()).toBe('void mainImage(out vec4 fragColor, in vec2 fragCoord) {');
    expect(dialect.moduleCaptureDeclaration('vec3', '_dbgCaptured0')).toBe('vec3 _dbgCaptured0;');
    expect(dialect.captureSelectorDeclaration()).toBe('uniform int _dbgVarIndex;');
    expect(dialect.captureOutputStatement('vec3', 'color')).toBe('  fragColor = vec4(color, 0.0);');
    expect(dialect.selectorFallbackStatement()).toBe('  fragColor = vec4(0.0);');
    expect(dialect.needsCaptureCoordInjection).toBe(true);
  });

  it('emits Slang capture scaffolding behind the same interface', () => {
    const dialect = getDebugDialect('slang');

    expect(dialect.name).toBe('slang');
    expect(dialect.mainImagePattern.test('float4 mainImage(float2 fragCoord)')).toBe(true);
    expect(dialect.mainImageWrapperOpen()).toBe('float4 mainImage(float2 fragCoord) {');
    expect(dialect.moduleCaptureDeclaration('float3', '_dbgCaptured0')).toBe('static float3 _dbgCaptured0;');
    expect(dialect.captureSelectorDeclaration()).toBeNull();
    expect(dialect.captureOutputStatement('float3', 'color')).toBe('  return float4(color, 0.0);');
    expect(dialect.selectorFallbackStatement()).toBe('  return float4(0.0);');
    expect(dialect.needsCaptureCoordInjection).toBe(false);
  });
});

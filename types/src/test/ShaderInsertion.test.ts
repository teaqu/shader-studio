import { describe, expect, it } from 'vitest';
import { createShaderInsertion, insertionLanguage } from '../ShaderInsertion';
import { getShaderSourceFunctions } from '../ShaderEntryPoints';

describe('shader source insertion', () => {
  it.each(['glsl', 'slang', 'wgsl'])('adds and reuses a built-in %s buffer hook', language => {
    const options = { fileType: `${language}-buffer`, authoringMode: 'hooks' as const };
    const first = createShaderInsertion('// mainImage in a comment', options);
    expect(first.text).toContain('mainImage(');
    expect(first.entryPoints).toBeUndefined();
    expect(createShaderInsertion(first.text, options).text).toBe('');
  });
  it.each(['slang', 'wgsl'] as const)('creates only a native %s vertex and avoids name collisions', language => {
    const options = { fileType: `${language}-vertex`, authoringMode: 'native' as const, passName: 'BufferA', geometryType: 'vertices', vertexSpace: 'clip' };
    const first = createShaderInsertion('', options);
    expect(first.entryPoints).toEqual({ vertex: 'BufferAVertex' });
    expect(getShaderSourceFunctions(first.text, language).filter(fn => fn.stage)).toMatchObject([{ name: 'BufferAVertex', stage: 'vertex' }]);
    expect(first.text).not.toContain('iViewProjection *');
    expect(createShaderInsertion(first.text, options).entryPoints?.vertex).toBe('BufferAVertex2');
  });
  it.each(['slang', 'wgsl'])('provides attributes and varyings for a native %s mesh vertex', language => {
    const result = createShaderInsertion('', { fileType: `${language}-vertex`, authoringMode: 'native', geometryType: 'cube' });
    expect(result.text).toContain('worldPosition');
    expect(result.text).toContain('normal');
  });
  it.each(['slang', 'wgsl'])('supports both %s compute modes', language => {
    const builtin = createShaderInsertion('', { fileType: `${language}-compute` });
    expect(builtin.entryPoints?.compute).toBe('compute');
    expect(createShaderInsertion(builtin.text, { fileType: `${language}-compute` }).text).toBe('');
    expect(createShaderInsertion('', { fileType: `${language}-compute`, authoringMode: 'native', passName: 'Sim' }).entryPoints?.compute).toBe('SimCompute');
  });
  it('rejects unsupported types, native GLSL, and GLSL compute', () => {
    expect(() => insertionLanguage('wgsl-common')).toThrow('Insert supports');
    expect(() => createShaderInsertion('', { fileType: 'glsl-buffer', authoringMode: 'native' })).toThrow('Native insertion');
    expect(() => createShaderInsertion('', { fileType: 'glsl-compute' })).toThrow('Compute insertion');
  });
});

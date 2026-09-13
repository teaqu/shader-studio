import { describe, expect, it } from 'vitest';
import { findSlangAuthoredDeclarations } from './SlangAuthoredDeclarations';

describe('authored Slang declarations shared by renderer and language service', () => {
  it.each([
    'float albedo = float(1);',
    'float x; float albedo;',
    'float\nalbedo;',
    'float x = float(1), albedo = 2;',
    'property float albedo { get { return 1; } }',
    'struct albedo\n{ float member; };',
    'typedef float albedo;',
    'typealias albedo = float;',
    '[shader("fragment")] float4 albedo(float2 p) { return 1; }',
  ])('locates the actual declared name in %s', source => {
    expect(findSlangAuthoredDeclarations(source)).toContainEqual({ name: 'albedo', offset: source.indexOf('albedo') });
  });
  it('does not mistake an initializer call or its arguments for a declaration', () => {
    expect(findSlangAuthoredDeclarations('float result = sampleValue(x, albedo);').map(item => item.name)).toEqual(['result']);
  });
  it('ignores locals, members, comments and strings and preserves authored inputs', () => {
    const source = '// albedo\nstruct Data { float albedo; }; float inputs; void f() { float albedo; }';
    expect(findSlangAuthoredDeclarations(source).map(item => item.name)).toEqual(['Data', 'inputs', 'f']);
  });
});

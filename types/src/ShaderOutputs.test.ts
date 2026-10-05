import { describe, expect, it } from 'vitest';
import { getShaderOutputs } from './ShaderOutputs';

describe('selected fragment outputs', () => {
  it('uses one implicit output for built-in functions', () => {
    expect(getShaderOutputs('', 'wgsl').outputs).toEqual([{ slot: 0 }]);
  });
  it('reads WGSL struct fields in slot order, ignoring comments and depth', () => {
    const source = `struct Result { @location(1) normal: vec4f, @builtin(frag_depth) depth: f32, @location(0) colour: vec4f }
      // @location(7) fake: vec4f
      @fragment fn draw() -> Result { return Result(); }
      @fragment fn other() -> @location(0) vec4f { return vec4f(1); }`;
    expect(getShaderOutputs(source, 'wgsl', 'draw').outputs).toEqual([{ slot: 0, name: 'colour' }, { slot: 1, name: 'normal' }]);
    expect(getShaderOutputs(source, 'wgsl', 'other').outputs).toEqual([{ slot: 0 }]);
  });
  it('resolves WGSL output aliases', () => {
    expect(getShaderOutputs('struct R { @location(0) colour: vec4f } alias Output = R; @fragment fn draw() -> Output { return Output(); }', 'wgsl', 'draw').outputs).toEqual([{ slot: 0, name: 'colour' }]);
  });
  it('reads Slang target semantics and ignores inputs', () => {
    const source = `struct R { float4 colour : SV_Target0; float4 normal : SV_Target1; float depth : SV_Depth; };
      [shader("fragment")] R draw(float4 input : SV_Position) { return (R)0; }`;
    expect(getShaderOutputs(source, 'slang', 'draw').outputs).toEqual([{ slot: 0, name: 'colour' }, { slot: 1, name: 'normal' }]);
    expect(getShaderOutputs('[shader("fragment")] float4 draw() : SV_Target { return 0; }', 'slang', 'draw').outputs).toEqual([{ slot: 0 }]);
  });
  it('never treats missing or incomplete native code as one output', () => {
    for (const source of ['', '@fragment fn draw() -> R {', '@fragment fn draw() -> Missing { return Missing(); }']) {
      expect(getShaderOutputs(source, 'wgsl', 'draw').error).toBeTruthy();
      expect(getShaderOutputs(source, 'wgsl', 'draw').outputs).toEqual([]);
    }
  });
  it('rejects sparse and duplicate slots rather than renumbering them', () => {
    for (const slots of [[0, 2], [0, 0]]) {
      const fields = slots.map((slot, i) => `@location(${slot}) c${i}: vec4f`).join(',');
      expect(getShaderOutputs(`struct R { ${fields} } @fragment fn draw() -> R { return R(); }`, 'wgsl', 'draw').error).toContain('contiguous');
    }
  });
});

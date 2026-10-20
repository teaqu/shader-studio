import { describe, it, expect } from 'vitest';
import { ScriptStream } from './ScriptStream';
import { readScriptUniform, scriptUniformHelpers as h, scriptUniformDeclaration, zeroScriptUniform, parseScriptUniformType } from './ScriptUniforms';
describe('script output contract', () => {
  it('preserves vector inference and explicitly distinguishes short arrays', () => {
    expect(readScriptUniform([1, 2])?.type).toBe('vec2');
    expect(readScriptUniform(h.floatArray([1, 2]))).toEqual({ type: 'float[2]', value: [1, 2] });
    expect(scriptUniformDeclaration('lookup', 'uint[2]')).toBe('uniform uint lookup[2];');
    expect(zeroScriptUniform('int[3]')).toEqual([0, 0, 0]);
  });
  it('preserves exact integer boundaries and rejects invalid values/types', () => {
    expect(readScriptUniform(h.uint(4294967295))?.value).toBe(4294967295);
    expect(readScriptUniform(h.int(-2147483648))?.value).toBe(-2147483648);
    for (const value of [-1, 1.5, 4294967296, NaN, Infinity]) {
      expect(() => h.uint(value)).toThrow();
    }
    expect(() => h.int(2147483648)).toThrow();
    expect(() => h.floatArray([])).toThrow();
    expect(() => h.intArray([1, 0.5])).toThrow();
    expect(() => readScriptUniform({ scriptUniformType: 'uint[2]', value: [1] })).toThrow();
    expect(parseScriptUniformType('float[1025]')).toBeNull();
    expect(parseScriptUniformType('uint[0]')).toBeNull();
  });
  it('copies input and preserves ordered chunks until acknowledgement', () => {
    const s = new ScriptStream({ maxPerFrame: 3, maxQueued: 6 });
    const source = new Uint32Array([1, 2]);
    s.push(source);
    source[0] = 9;
    s.push([3, 4, 5]);
    expect(s.peek()).toEqual([1, 2, 3]);
    expect(s.peek()).toEqual([1, 2, 3]);
    expect(s.push([6, 7])).toBe(false);
    expect(s.queued).toBe(5);
    s.consume(3);
    expect(s.peek()).toEqual([4, 5]);
    s.consume(2);
    expect(s.peek()).toEqual([]);
  });
  it('rejects invalid words atomically, validates limits and disables disposed producers', () => {
    expect(() => new ScriptStream({ maxPerFrame: 0 })).toThrow();
    expect(() => new ScriptStream({ maxPerFrame: 3, maxQueued: 2 })).toThrow();
    const s = new ScriptStream();
    expect(() => s.push([1, -1])).toThrow();
    expect(s.queued).toBe(0);
    expect(() => s.consume(1)).toThrow();
    s.push([1]);
    s.clear();
    expect(s.queued).toBe(0);
    s.dispose();
    expect(s.push([1])).toBe(false);
  });
});

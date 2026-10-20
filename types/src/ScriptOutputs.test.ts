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

describe('script uniform validation boundaries', () => {
  it.each(['float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4'])('parses and declares %s', type => {
    expect(parseScriptUniformType(type)).toEqual({ base: type });
    expect(scriptUniformDeclaration('value', type)).toBe(`uniform ${type} value;`);
  });
  it.each(['float[1]', 'int[1024]', 'uint[2]'])('accepts bounded arrays %s', type => {
    expect(parseScriptUniformType(type)).not.toBeNull();
  });
  it.each(['vec2[2]', 'bool[1]', 'float[01]', 'float[-1]', 'int[1.5]', '', 'float[999999999999999999999999999]'])('rejects unsupported type %s', type => {
    expect(parseScriptUniformType(type)).toBeNull();
    expect(() => scriptUniformDeclaration('value', type)).toThrow('Unsupported uniform type');
  });
  it('infers plain scalars/vectors, copies arrays and supplies appropriate defaults', () => {
    expect(readScriptUniform(1.5)).toEqual({ type: 'float', value: 1.5 });
    expect(readScriptUniform(true)).toEqual({ type: 'bool', value: true });
    expect(readScriptUniform(false)).toEqual({ type: 'bool', value: false });
    for (const length of [2, 3, 4]) {
      const value = new Array<number>(length).fill(1);
      const result = readScriptUniform(value);
      expect(result).toEqual({ type: `vec${length}`, value });
      expect(result?.value).not.toBe(value);
      expect(zeroScriptUniform(`vec${length}`)).toEqual(new Array<number>(length).fill(0));
    }
    for (const value of [null, undefined, '1', {}, [], [1], [1, 2, 3, 4, 5], { value: 1 }]) {
      expect(readScriptUniform(value)).toBeNull();
    }
    expect(zeroScriptUniform('bool')).toBe(false);
    expect(zeroScriptUniform('float')).toBe(0);
    expect(zeroScriptUniform('unsupported')).toBe(0);
  });
  it('validates all explicit scalar helpers and clones their arrays', () => {
    expect(h.int(2147483647)).toEqual({ scriptUniformType: 'int', value: 2147483647 });
    expect(h.uint(0)).toEqual({ scriptUniformType: 'uint', value: 0 });
    expect(h.intArray([-2147483648, 2147483647])).toEqual({ scriptUniformType: 'int[2]', value: [-2147483648, 2147483647] });
    expect(h.uintArray([0, 4294967295])).toEqual({ scriptUniformType: 'uint[2]', value: [0, 4294967295] });
    const source = [1, 2];
    const result = h.floatArray(source);
    source[0] = 9;
    expect(result.value).toEqual([1, 2]);
    expect(h.floatArray(new Array<number>(1024).fill(0)).scriptUniformType).toBe('float[1024]');
    expect(() => h.floatArray(new Array<number>(1025).fill(0))).toThrow('1–1024');
    expect(() => h.floatArray(null as unknown as number[])).toThrow('expect an array');
    for (const value of [-2147483649, 0.5, NaN, Infinity]) {
      expect(() => h.int(value)).toThrow('Invalid int');
    }
    for (const value of [NaN, Infinity, Number.MAX_VALUE]) {
      expect(() => readScriptUniform(value)).toThrow('Invalid float');
      expect(() => readScriptUniform([0, value])).toThrow('Invalid float');
      expect(() => h.floatArray([value])).toThrow('Invalid float');
    }
  });
  it.each([
    { scriptUniformType: 1, value: 1 },
    { scriptUniformType: 'vec2', value: [1, 2] },
    { scriptUniformType: 'bool', value: true },
    { scriptUniformType: 'nope', value: 1 },
    { scriptUniformType: 'int', value: [1] },
    { scriptUniformType: 'uint', value: '1' },
    { scriptUniformType: 'float[1]', value: 1 },
    { scriptUniformType: 'int[2]', value: [1, 0.5] },
  ])('rejects malformed explicit uniform %#', value => {
    expect(() => readScriptUniform(value)).toThrow();
  });
});

describe('stream bounds and independent cursors', () => {
  it.each([
    { maxPerFrame: 1.5 }, { maxPerFrame: 65537 }, { maxPerFrame: NaN },
    { maxQueued: 1048577 }, { maxQueued: 4096.5 }, { maxQueued: NaN },
  ])('rejects invalid limits %#', options => {
    expect(() => new ScriptStream(options)).toThrow('Stream limits');
  });
  it('accepts limit endpoints and defaults', () => {
    const stream = new ScriptStream();
    expect(stream.maxPerFrame).toBe(4096);
    expect(stream.maxQueued).toBe(65536);
    expect(new ScriptStream({ maxPerFrame: 65536, maxQueued: 1048576 }).maxQueued).toBe(1048576);
    expect(new ScriptStream({ maxPerFrame: 1, maxQueued: 1 }).push([4294967295])).toBe(true);
  });
  it.each([null, { length: -1 }, { length: 0.5 }, { length: Infinity }, { length: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed array-like input %#', data => {
    expect(() => new ScriptStream().push(data as unknown as ArrayLike<number>)).toThrow('expects uint32');
  });
  it.each([0.5, 4294967296, Infinity, NaN])('rejects invalid uint word %s atomically', word => {
    const stream = new ScriptStream();
    expect(() => stream.push([1, word])).toThrow();
    expect(stream.peek()).toEqual([]);
  });
  it('acknowledges partial chunks and multiple whole chunks in order', () => {
    const stream = new ScriptStream({ maxPerFrame: 8, maxQueued: 8 });
    expect(stream.push([])).toBe(true);
    stream.push([1, 2, 3]);
    stream.push([4, 5]);
    stream.consume(1);
    expect(stream.peek()).toEqual([2, 3, 4, 5]);
    stream.consume(3);
    expect(stream.peek()).toEqual([5]);
    stream.consume(0);
    for (const count of [-1, 0.5, NaN, Infinity, 2]) {
      expect(() => stream.consume(count)).toThrow('Invalid stream acknowledgement');
    }
    expect(stream.queued).toBe(1);
  });
  it('preserves initial queue only for the first fork and broadcasts later pushes independently', () => {
    const producer = new ScriptStream({ maxPerFrame: 2, maxQueued: 4 });
    producer.push([1, 2, 3]);
    producer.consume(1);
    const first = producer.fork();
    const second = producer.fork();
    expect(first.peek()).toEqual([2, 3]);
    expect(second.peek()).toEqual([]);
    producer.push([4, 5]);
    expect(producer.queued).toBe(4);
    expect(producer.push([6])).toBe(false);
    first.consume(3);
    expect(first.peek()).toEqual([5]);
    expect(second.peek()).toEqual([4, 5]);
    expect(producer.queued).toBe(2);
    producer.release(second);
    expect(second.push([1])).toBe(false);
    expect(producer.queued).toBe(1);
    producer.clear();
    expect(first.peek()).toEqual([]);
    producer.push([6]);
    expect(first.peek()).toEqual([6]);
    producer.dispose();
    expect(first.queued).toBe(0);
    expect(first.push([7])).toBe(false);
    expect(producer.push([7])).toBe(false);
  });
});

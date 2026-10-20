import { describe, it, expect, vi } from 'vitest';
import { uploadTypedScriptUniform } from '../../webgl/ScriptUniformUpload';
import { mergeCustomUniformValues, CustomUniformManager } from '../../webgl/CustomUniformManager';
describe('typed script uniform uploads', () => {
  it('uploads exact integers and each scalar array type', () => {
    const gl = { getUniformLocation: vi.fn(() => ({})), uniform1ui: vi.fn(), uniform1i: vi.fn(), uniform1uiv: vi.fn(), uniform1iv: vi.fn(), uniform1fv: vi.fn() };
    const context = gl as unknown as WebGL2RenderingContext;
    const program = {} as WebGLProgram;
    for (const [type, value] of [['uint', 4294967295], ['int', -2147483648], ['uint[2]', [0, 4294967295]], ['int[2]', [-1, 2]], ['float[2]', [.5, 1]]] as const) {
      expect(uploadTypedScriptUniform(context, program, { name: 'value', type, value: typeof value === 'number' ? value : [...value] })).toBe(true);
    }
    expect(gl.uniform1ui).toHaveBeenCalledWith(expect.anything(), 4294967295);
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.anything(), -2147483648);
    expect(gl.uniform1uiv).toHaveBeenCalledWith(expect.anything(), new Uint32Array([0, 4294967295]));
    expect(gl.uniform1iv).toHaveBeenCalledWith(expect.anything(), new Int32Array([-1, 2]));
    expect(gl.uniform1fv).toHaveBeenCalledWith(expect.anything(), [.5, 1]);
    expect(gl.getUniformLocation).toHaveBeenLastCalledWith(program, 'value[0]');
    expect(uploadTypedScriptUniform(context, program, { name: 'v', type: 'vec2', value: [1, 2] })).toBe(false);
    gl.getUniformLocation.mockReturnValueOnce(null as unknown as object);
    expect(uploadTypedScriptUniform(context, program, { name: 'unused', type: 'uint', value: 1 })).toBe(true);
  });
  it('retains typed shapes, creates zero arrays and snapshots mutable values', () => {
    const manager = new CustomUniformManager();
    manager.loadDeclarations('uniform uint ids[2];', [{ name: 'ids', type: 'uint[2]' }]);
    expect(manager.getCurrentValues()).toEqual([{ name: 'ids', type: 'uint[2]', value: [0, 0] }]);
    const values = [1, 2];
    manager.updateValues([{ name: 'ids', type: 'uint[2]', value: values }]);
    values[0] = 9;
    expect(manager.getValues()[0].value).toEqual([1, 2]);
  });
});


describe('uniform transport buffering', () => {
  it('merges early partial updates and snapshots arrays until compilation can use them', () => {
    const array = [1, 2];
    const first = mergeCustomUniformValues(null, [{name: 'ids', type: 'uint[2]', value: array}]);
    array[0] = 9;
    const second = mergeCustomUniformValues(first, [{name: 'tick', type: 'uint', value: 4294967295}]);
    expect(second).toEqual([{name: 'ids', type: 'uint[2]', value: [1,2]}, {name: 'tick', type: 'uint', value: 4294967295}]);
    expect(mergeCustomUniformValues(second, [{name: 'tick', type: 'uint', value: 3}])[1].value).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { ShaderDebugger, SlangDebugEngine } from '../index';

describe('@shader-studio/debug public exports', () => {
  it('provides both GLSL and Slang debug engines from one package', () => {
    expect(ShaderDebugger).toBeTypeOf('function');
    expect(SlangDebugEngine).toBeTypeOf('function');
  });
});

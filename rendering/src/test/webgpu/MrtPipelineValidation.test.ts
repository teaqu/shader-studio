import { describe, expect, it } from 'vitest';
import { nativeFragmentWritesDepth, validateMrtPipeline } from '../../webgpu/MrtPipelineValidation';

const device = { limits: {} } as GPUDevice;
const source = 'struct Result { @location(0) colour: vec4f, @location(1) normal: vec4f } @fragment fn draw() -> Result { return Result(); }';
describe('native MRT pipeline limits and output signatures', () => {
  it('validates attachment byte limits independently of attachment count', () => {
    expect(validateMrtPipeline(device, 'rgba32float', 3, source, 'draw')).toContain('48 bytes per sample');
    expect(validateMrtPipeline(device, 'rgba16float', 2, source, 'draw')).toBeUndefined();
  });

  it.each([undefined, 'missing', 'draw'])('rejects a missing native output signature for %s', (entry) => {
    expect(validateMrtPipeline(device, 'rgba16float', 2, '@fragment fn draw() {}', entry)).toContain('selected native fragment');
    expect(nativeFragmentWritesDepth('@fragment fn draw() {}', entry)).toBe(false);
  });

  it('recognizes direct single output annotations and depth fields', () => {
    expect(validateMrtPipeline(device, 'rgba16float', 2, '@fragment fn draw() -> @location(0) vec4f { return vec4f(); }', 'draw')).toContain('contiguous');
    expect(nativeFragmentWritesDepth('struct Result { @builtin(frag_depth) depth: f32 } @fragment fn draw() -> Result { return Result(); }', 'draw')).toBe(true);
    expect(nativeFragmentWritesDepth('@fragment fn draw() -> Unknown { }', 'draw')).toBe(false);
  });
});

import { expect, it } from 'vitest';
import { emitNativeRasterWrapper } from '../native/NativeRasterWrapper';
import type { NativeRasterReplay } from '../native/NativeRasterReplay';

it('rewrites raster setup aliases and preserves per-slot capture output conversion', () => {
  const replay = {
    call: 'userFragment()', wrapperHeader: 'float4 fragment()', returnType: 'float4',
    coordinateSetup: '', coordinateName: 'pixelPosition',
    returnColor: (_result: string, color: string) => `return ${color};`,
  } as NativeRasterReplay;
  const wrapper = emitNativeRasterWrapper(replay, 'slang', '_capture', 'capture',
    [{ typeName: 'float', expression: 'sample' }], () => 'preview',
    (type, expression) => `float4(${type}(${expression}))`, ['float x = fragCoord.x;'], '_executed', false);
  expect(wrapper).toContain('float x = pixelPosition.x;');
  expect(wrapper).toContain('return float4(float(sample));');
  expect(wrapper).not.toContain('_executed = false');
});

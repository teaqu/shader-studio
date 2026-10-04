import { describe, expect, it } from 'vitest';
import { validateWgslTraceLaunch, type WgslTraceLaunch } from './WgslTrace';

const launch: WgslTraceLaunch = { source: '', path: '/image.wgsl', width: 4, height: 4,
  pixel: [1, 2], time: 1, frame: 2, capacity: 32 };

describe('WGSL trace preview frame inputs', () => {
  it.each([
    { path: '/image.glsl' }, { source: null }, { width: 0 }, { height: 2049 }, { width: 1.5 },
    { pixel: null }, { pixel: [0] }, { pixel: [-1, 0] }, { pixel: [0.5, 0] }, { pixel: [4, 0] }, { pixel: [0, 4] },
    { time: Infinity }, { frame: -1 }, { frame: 0.5 }, { frame: 0x80000000 },
    { capacity: 0 }, { capacity: 1.5 }, { capacity: 16385 },
  ])('rejects invalid recording bounds %j', patch => {
    expect(() => validateWgslTraceLaunch({ ...launch, ...patch } as unknown as WgslTraceLaunch)).toThrow();
  });

  it('accepts inclusive recording bounds and sparse frame inputs', () => {
    expect(() => validateWgslTraceLaunch({ ...launch, width: 2048, height: 1, pixel: [2047, 0],
      frame: 0x7fffffff, capacity: 16384, uniforms: { timeDelta: 0 } })).not.toThrow();
  });
  it('accepts explicit preview inputs and legacy defaults', () => {
    expect(() => validateWgslTraceLaunch(launch)).not.toThrow();
    expect(() => validateWgslTraceLaunch({ ...launch, uniforms: { timeDelta: 0.1, frameRate: 60,
      mouse: [1, 2, 3, 4], date: [2026, 10, 3, 120], cameraPos: [1, 2, 3], cameraDir: [0, 0, 1], sampleRate: 48000 } } as WgslTraceLaunch)).not.toThrow();
  });

  it.each([null, [], 'invalid', { mouse: 0 }, { mouse: [1, 2] }, { date: [1, 2, 3, Infinity] },
    { cameraPos: [1, 2, '3'] }, { cameraDir: [1, 2, 1e100] },
    { frameRate: NaN }, { timeDelta: '1' }, { sampleRate: Infinity }])('rejects malformed preview inputs %j', uniforms => {
    expect(() => validateWgslTraceLaunch({ ...launch, uniforms } as unknown as WgslTraceLaunch)).toThrow();
  });
});

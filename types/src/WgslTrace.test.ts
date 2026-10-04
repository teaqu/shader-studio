import { describe, expect, it } from 'vitest';
import { validateWgslTraceLaunch, type WgslTraceLaunch } from './WgslTrace';

const launch: WgslTraceLaunch = { source: '', path: '/image.wgsl', width: 4, height: 4,
  pixel: [1, 2], time: 1, frame: 2, capacity: 32 };

describe('WGSL trace preview frame inputs', () => {
  it('accepts explicit preview inputs and legacy defaults', () => {
    expect(() => validateWgslTraceLaunch(launch)).not.toThrow();
    expect(() => validateWgslTraceLaunch({ ...launch, uniforms: { timeDelta: 0.1, frameRate: 60,
      mouse: [1, 2, 3, 4], date: [2026, 10, 3, 120], cameraPos: [1, 2, 3], cameraDir: [0, 0, 1], sampleRate: 48000 } } as WgslTraceLaunch)).not.toThrow();
  });

  it.each([null, [], { mouse: [1, 2] }, { date: [1, 2, 3, Infinity] },
    { cameraPos: [1, 2, '3'] }, { cameraDir: [1, 2, 1e100] },
    { frameRate: NaN }, { timeDelta: '1' }, { sampleRate: Infinity }])('rejects malformed preview inputs %j', uniforms => {
    expect(() => validateWgslTraceLaunch({ ...launch, uniforms } as unknown as WgslTraceLaunch)).toThrow();
  });
});

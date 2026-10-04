import { describe, expect, it } from 'vitest';
import { validateWgslTraceRecording } from './WgslTraceRecording';

const recording = {
  path: '/project/image.wgsl',
  source: 'fn mainImage() {}',
  sources: [
    { path: '/project/common.wgsl', source: 'fn helper() {}' },
    { path: '/project/image.wgsl', source: 'fn mainImage() {}' },
  ],
  color: [0, 0, 0, 1],
  overflow: false,
  sites: [
    { id: 0, path: '/project/common.wgsl', functionName: 'helper', line: 2, column: 3, variables: [] },
    { id: 1, path: '/project/image.wgsl', functionName: 'mainImage', line: 5, column: 1, variables: [] },
  ],
  events: [
    { siteId: 0, path: '/project/common.wgsl', functionName: 'helper', line: 2, column: 3,
      values: [{ name: 'x', type: 'f32', value: 1.25 }] },
    { siteId: 1, path: '/project/image.wgsl', functionName: 'mainImage', line: 5, column: 1,
      values: [{ name: 'answer', type: 'u32', value: 42 }] },
  ],
};

describe('WGSL project trace recording validation', () => {
  it('accepts a multi-source recording whose events map exactly to source sites', () => {
    expect(() => validateWgslTraceRecording(recording)).not.toThrow();
  });

  it('accepts recursive aggregate values, boolean vectors, and site-backed frames', () => {
    const value = {
      name: 'scene', type: 'Scene', value: '<aggregate>', children: [
        { name: 'visible', type: 'bool', value: [true, false, true] },
        { name: 'particle', type: 'Particle', value: '<aggregate>', children: [
          { name: 'position', type: 'vec4f', value: [0.25, 0.5, 0.75, 1] },
        ] },
      ],
    };
    expect(() => validateWgslTraceRecording({ ...recording, events: [{ ...recording.events[0], values: [value], frames: [
      { id: 10, path: '/project/common.wgsl', functionName: 'helper', line: 2, column: 3, values: [value] },
      { id: 20, path: '/project/image.wgsl', functionName: 'mainImage', line: 5, column: 1, values: [] },
    ] }] })).not.toThrow();
  });

  it.each([
    ['unknown event site', { ...recording, events: [{ ...recording.events[0], siteId: 99 }] }],
    ['event path mismatch', { ...recording, events: [{ ...recording.events[0], path: '/project/image.wgsl' }] }],
    ['event function mismatch', { ...recording, events: [{ ...recording.events[0], functionName: 'mainImage' }] }],
    ['event line mismatch', { ...recording, events: [{ ...recording.events[0], line: 3 }] }],
    ['duplicate frame id', { ...recording, events: [{ ...recording.events[0], frames: [
      { id: 1, path: '/project/common.wgsl', functionName: 'helper', line: 2, column: 3, values: [] },
      { id: 1, path: '/project/image.wgsl', functionName: 'mainImage', line: 5, column: 1, values: [] },
    ] }] }],
    ['frame location absent from sites', { ...recording, events: [{ ...recording.events[0], frames: [
      { id: 1, path: '/project/common.wgsl', functionName: 'helper', line: 99, column: 3, values: [] },
    ] }] }],
    ['site path absent from snapshots', { ...recording, sites: [{ ...recording.sites[0], path: '/other.wgsl' }] }],
    ['conflicting source snapshot', { ...recording, sources: [...recording.sources, { path: '/project/image.wgsl', source: 'different' }] }],
  ])('rejects %s', (_name, value) => {
    expect(() => validateWgslTraceRecording(value)).toThrow();
  });

  it.each([
    ['too many events', { ...recording, events: Array.from({ length: 16_385 }, () => recording.events[0]) }],
    ['negative site id', { ...recording, sites: [{ ...recording.sites[0], id: -1 }] }],
    ['zero source line', { ...recording, sites: [{ ...recording.sites[0], line: 0 }] }],
    ['zero source column', { ...recording, sites: [{ ...recording.sites[0], column: 0 }] }],
  ])('enforces recording bounds for %s', (_name, value) => {
    expect(() => validateWgslTraceRecording(value)).toThrow();
  });

  it.each([
    ['non-finite colour', { ...recording, color: [0, 0, 0, NaN] }],
    ['invalid event value', { ...recording, events: [{ ...recording.events[0], values: [{ name: 'x', type: 'f32', value: Infinity }] }] }],
    ['non-array source list', { ...recording, sources: {} }],
    ['non-array site variables', { ...recording, sites: [{ ...recording.sites[0], variables: {} }] }],
    ['non-array aggregate children', { ...recording, events: [{ ...recording.events[0], values: [{ name: 'x', type: 'S', value: '<aggregate>', children: {} }] }] }],
  ])('rejects invalid payload data: %s', (_name, value) => {
    expect(() => validateWgslTraceRecording(value)).toThrow();
  });

  it('bounds aggregate recursion', () => {
    let value: Record<string, unknown> = { name: 'leaf', type: 'f32', value: 1 };
    for (let index = 0; index <= 16; index += 1) {
      value = { name: `node${index}`, type: 'Node', value: '<aggregate>', children: [value] };
    }
    expect(() => validateWgslTraceRecording({ ...recording, events: [{ ...recording.events[0], values: [value] }] })).toThrow();
  });
});

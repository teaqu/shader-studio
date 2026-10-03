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

  it.each([
    ['unknown event site', { ...recording, events: [{ ...recording.events[0], siteId: 99 }] }],
    ['event path mismatch', { ...recording, events: [{ ...recording.events[0], path: '/project/image.wgsl' }] }],
    ['event function mismatch', { ...recording, events: [{ ...recording.events[0], functionName: 'mainImage' }] }],
    ['event line mismatch', { ...recording, events: [{ ...recording.events[0], line: 3 }] }],
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
  ])('rejects invalid payload data: %s', (_name, value) => {
    expect(() => validateWgslTraceRecording(value)).toThrow();
  });
});

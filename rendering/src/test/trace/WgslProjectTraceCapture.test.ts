import { describe, expect, it } from 'vitest';
import { decodeWgslProjectTracePixel, traceBindGroupIndexes, traceNeedsVertexBuffers } from '../../trace/WgslProjectTraceCapture';

describe('WGSL project trace capture helpers', () => {
  it('does not require frozen vertex buffers for shader-generated vertices', () => {
    expect(traceNeedsVertexBuffers({ geometry: 'vertices' })).toBe(false);
    expect(traceNeedsVertexBuffers({ geometry: 'fullscreen' })).toBe(false);
    expect(traceNeedsVertexBuffers({ geometry: 'cube' })).toBe(true);
    expect(traceNeedsVertexBuffers({ geometry: 'model' })).toBe(true);
  });
  it('does not allocate a trace bind group for a reference render', () => {
    expect(traceBindGroupIndexes(3, false)).toEqual([0]);
    expect(traceBindGroupIndexes(3, true)).toEqual([0, 1, 2, 3]);
  });

  it('decodes compute output in both supported float formats', () => {
    const f32 = new Float32Array([.25, -.5, 1, 0]).buffer;
    expect(decodeWgslProjectTracePixel(f32, 'rgba32float')).toEqual([.25, -.5, 1, 0]);
    const f16 = new Uint16Array([0x3800, 0xbc00, 0x3c00, 0]).buffer;
    expect(decodeWgslProjectTracePixel(f16, 'rgba16float')).toEqual([.5, -1, 1, 0]);
  });
});

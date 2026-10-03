import { describe, expect, it, vi } from 'vitest';
import type { WgslProjectTraceTarget } from '@shader-studio/types';
import type { WgslProjectTraceSnapshot } from '../trace/WgslProjectTraceCapture';
import { captureInstalledWgslTrace, traceDispatchUniforms, validateProjectTraceRequest, wgslTraceTargets } from '../trace/WgslProjectTraceController';
import type { RenderPassNode } from '../types/PassGraph';

const captures = vi.hoisted(() => ({ trace: vi.fn(), reference: vi.fn() }));
vi.mock('../trace/WgslProjectTraceCapture', () => ({ captureWgslProjectTrace: captures.trace, captureWgslProjectReference: captures.reference }));
const target: WgslProjectTraceTarget = { passName: 'Image', stage: 'fragment', path: '/project/image.wgsl', source: 'image', width: 64, height: 32 };
const request = { passName: 'Image', pixel: [2, 3] as [number, number], capacity: 64 };
const snapshot = { sourcePath: target.path, pass: { source: target.source, vertexSrc: 'vertex' }, commonCode: 'common', commonPath: '/project/common.wgsl', vertexPath: '/project/vertex.wgsl' } as WgslProjectTraceSnapshot;

describe('WGSL project trace controller', () => {
  it('resolves configured pass paths and separate vertex targets', () => {
    const passes = [{ name: 'Image', kind: 'render', source: 'image', vertexSrc: 'vertex', width: 64, height: 32 }, { name: 'Update', kind: 'compute', path: '../compute.wgsl', source: 'compute', width: 64, height: 32, entryPoint: 'update' }] as RenderPassNode[];
    expect(wgslTraceTargets(passes, null)).toEqual([]);
    const result = wgslTraceTargets(passes, { path: target.path, buffers: {} });
    expect(result.map(item => [item.stage, item.path])).toEqual([['fragment', target.path], ['vertex', '/project/Image.vert.wgsl'], ['compute', '/compute.wgsl']]);
    expect(result[2].entryPoint).toBe('update');
  });

  it('validates target selection, pixel bounds, capacity and invocation selectors', () => {
    expect(validateProjectTraceRequest(request, [target])).toBe(target);
    for (const invalid of [{ passName: 'missing' }, { stage: 'vertex' }, { pixel: [-1, 0] }, { pixel: [64, 0] }, { capacity: 0 }, { capacity: 16385 }, { invocation: [0, -1, 0] }, { vertexIndex: 0.5 }]) {
      expect(() => validateProjectTraceRequest({ ...request, ...invalid } as typeof request, [target])).toThrow();
    }
    expect(traceDispatchUniforms(3).map(data => Array.from(new Int32Array(data)))).toEqual([[0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0]]);
  });

  it('dispatches references separately and preserves immutable source snapshots', async () => {
    const recording = { sites: [], events: [], color: [0, 0, 0, 0], overflow: false };
    captures.trace.mockResolvedValue(recording); captures.reference.mockResolvedValue(recording);
    captures.trace.mockClear(); captures.reference.mockClear();
    const result = await captureInstalledWgslTrace(snapshot, target, request, undefined, () => true, true);
    expect(captures.trace).not.toHaveBeenCalled();
    expect(captures.reference).toHaveBeenCalledWith(snapshot, { ...request, stage: 'fragment' }, undefined);
    expect(result.sources).toEqual([{ path: target.path, source: 'image' }, { path: snapshot.commonPath, source: 'common' }, { path: snapshot.vertexPath, source: 'vertex' }]);
    await expect(captureInstalledWgslTrace(snapshot, target, request, undefined, () => false)).rejects.toThrow('changed during capture');
  });
});

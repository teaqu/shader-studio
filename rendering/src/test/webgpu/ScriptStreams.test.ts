import { describe, it, expect, vi } from 'vitest';
import { ScriptStreamDelivery } from '../../webgpu/ScriptStreamDelivery';
import { addScriptStreams } from '../../webgpu/ScriptStreamGraph';
import { buildSlangPassGraph } from '../../webgpu/SlangPassGraph';
import { buildStorageDeclarations, wrapSlangImageSource } from '../../webgpu/SlangPrelude';
const info = [{ name: 'net', maxPerFrame: 2, maxQueued: 8 }, { name: 'uart', maxPerFrame: 1, maxQueued: 8 }];
describe('script stream render contract', () => {
  it('waits for actual submission, keeps paused data and ignores stale requests', () => {
    const delivery = new ScriptStreamDelivery();
    const send = vi.fn();
    const write = vi.fn();
    delivery.configure(info, 7, send);
    delivery.prepare(write, false);
    expect(send).not.toHaveBeenCalled();
    delivery.prepare(write, true);
    const request = send.mock.calls[0][0];
    const frame = { session: 7, sequence: 1, streams: [{ name: 'net', data: [11, 12], queued: 3 }, { name: 'uart', data: [13], queued: 1 }] };
    expect(delivery.receive(frame, request.request - 1)).toBe(false);
    expect(delivery.receive({ ...frame, session: 6 }, request.request)).toBe(false);
    expect(delivery.receive(frame, request.request)).toBe(true);
    write.mockClear();
    delivery.prepare(write, false);
    delivery.submitted(false);
    expect([...write.mock.calls[0][1]]).toEqual([0]);
    expect(send).toHaveBeenCalledTimes(1);
    write.mockClear();
    delivery.prepare(write, true);
    expect([...write.mock.calls[0][1]]).toEqual([2, 11, 12]);
    // Retry before a submission sees the same leased data.
    delivery.prepare(write, true);
    expect(send).toHaveBeenCalledTimes(1);
    delivery.submitted(true);
    expect(send.mock.calls[1][0].acknowledgedSequence).toBe(1);
    expect(delivery.status()[0]).toMatchObject({ queued: 1, lastFrame: 2 });
    expect(delivery.receive(frame, request.request)).toBe(false);
    delivery.reset();
    expect(delivery.receive(frame, send.mock.calls[1][0].request)).toBe(false);
    delivery.dispose();
    expect(delivery.status()).toEqual([]);
  });
  it('rejects malformed/oversized chunks and keeps empty frames empty', () => {
    const delivery = new ScriptStreamDelivery();
    const send = vi.fn();
    const write = vi.fn();
    delivery.configure([info[0]], 1, send);
    delivery.prepare(write, true);
    const request = send.mock.calls[0][0].request;
    const frame = { session: 1, sequence: 1, streams: [{ name: 'net', data: [1, 2, 3], queued: 3 }] };
    expect(delivery.receive(frame, request)).toBe(false);
    expect(delivery.receive({ ...frame, streams: [{ name: 'net', data: [-1], queued: 1 }] }, request)).toBe(false);
    expect(delivery.receive({ ...frame, streams: [] }, request)).toBe(false);
    expect(delivery.receive({ ...frame, streams: [{ name: 'net', data: [], queued: 0 }] }, request)).toBe(true);
    delivery.prepare(write, true);
    expect([...write.mock.calls.at(-1)![1]]).toEqual([0]);
  });
  it('generates read-only length/data bindings for compute and render passes', () => {
    const graph = buildSlangPassGraph({ imageCode: 'float4 mainImage(float2 p){return float4(net.length);}', config: null, buffers: {}, canvasWidth: 1, canvasHeight: 1 });
    addScriptStreams(graph, info);
    expect(graph.errors).toEqual([]);
    expect(graph.storage[0]).toMatchObject({ count: 3, stride: 4, streamMaxPerFrame: 2 });
    for (const kind of ['compute', 'render'] as const) {
      const code = buildStorageDeclarations(graph.storage, 0, kind).beforeCommon;
      expect(code).toContain('uint length; uint data[2]');
      expect(code).toContain('StructuredBuffer<_ScriptStream_net>');
      expect(code).not.toContain('RWStructuredBuffer');
      expect(code).toContain('#define net (_scriptStream_net[0])');
    }
    addScriptStreams(graph, [info[0]]);
    expect(graph.errors.join()).toContain('conflicts');
  });
  it('validates graph metadata and catches uniform/channel/storage collisions', () => {
    const graph = buildSlangPassGraph({ imageCode: '', config: null, buffers: {}, canvasWidth: 1, canvasHeight: 1 });
    addScriptStreams(graph, [{ ...info[0], maxPerFrame: 0 }], []);
    expect(graph.errors.join()).toContain('Invalid');
    addScriptStreams(graph, [info[0]], [{ name: 'net' }]);
    expect(graph.errors.join()).toContain('conflicts');
  });
  it('declares scalar integers and fixed arrays in the Slang uniform block', () => {
    const code = wrapSlangImageSource('float4 mainImage(float2 p){return float4(1);}', { customUniforms: [{ name: 'counter', type: 'uint' }, { name: 'table', type: 'int[3]' }] });
    expect(code).toContain('uint custom_counter;');
    expect(code).toContain('int custom_table[3];');
    expect(code).toContain('#define table (_st.custom_table)');
  });
});

describe('paused stream queue monitoring',()=>{
  it('refreshes queue counts without taking or acknowledging a chunk',()=>{
    const delivery=new ScriptStreamDelivery();const send=vi.fn();delivery.configure(info,1,send);
    delivery.refreshStatus();const request=send.mock.calls[0][0];
    expect(request.status).toBe(true);expect(request.acknowledgedSequence).toBeUndefined();
    delivery.receiveStatus({session:1,consumer:request.consumer,request:request.request,streams:[{name:'net',queued:7}]});
    expect(delivery.status()[0].queued).toBe(7);
    delivery.reset();delivery.receiveStatus({session:1,consumer:request.consumer,request:request.request,streams:[{name:'net',queued:8}]});
    expect(delivery.status()[0].queued).toBe(0);
    delivery.dispose();
  });
});


describe('delayed queue status replies', () => {
  it('accepts delayed replies in order and ignores replies from before reset', () => {
    const delivery = new ScriptStreamDelivery(); const send = vi.fn();
    delivery.configure(info, 1, send);
    delivery.refreshStatus(); const first = send.mock.calls[0][0];
    delivery.refreshStatus(); const second = send.mock.calls[1][0];
    delivery.receiveStatus({ session: 1, consumer: first.consumer, request: first.request, streams: [{name: 'net', queued: 3}] });
    expect(delivery.status()[0].queued).toBe(3);
    delivery.receiveStatus({ session: 1, consumer: second.consumer, request: second.request, streams: [{name: 'net', queued: 5}] });
    delivery.receiveStatus({ session: 1, consumer: first.consumer, request: first.request, streams: [{name: 'net', queued: 1}] });
    expect(delivery.status()[0].queued).toBe(5);
    delivery.reset();
    delivery.receiveStatus({ session: 1, consumer: second.consumer, request: second.request, streams: [{name: 'net', queued: 8}] });
    expect(delivery.status()[0].queued).toBe(0);
    delivery.dispose();
  });
});

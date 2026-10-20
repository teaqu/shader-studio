import { describe, it, expect, vi } from 'vitest';
import { ScriptStreamDelivery } from '../../webgpu/ScriptStreamDelivery';
import { addScriptStreams } from '../../webgpu/ScriptStreamGraph';
import { buildSlangPassGraph } from '../../webgpu/SlangPassGraph';
import { buildWgslStorageDeclarations } from '../../webgpu/WgslPrelude';
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

describe('stream delivery validation and lifecycle', () => {
  it('does nothing without configured streams, including submission without a frame', () => {
    const delivery = new ScriptStreamDelivery();
    const write = vi.fn();
    delivery.refreshStatus();
    delivery.prepare(write, true);
    delivery.submitted(true);
    expect(write).not.toHaveBeenCalled();
    expect(delivery.receive({ session: 0, sequence: 1, streams: [] }, 0)).toBe(false);
    expect(delivery.status()).toEqual([]);
    delivery.dispose();
  });
  it('isolates input metadata and releases the previous session when reconfigured', () => {
    const delivery = new ScriptStreamDelivery();
    const send = vi.fn();
    const metadata = [{ ...info[0] }];
    delivery.configure(metadata, 1, send);
    metadata[0].name = 'mutated';
    expect(delivery.status()[0]).toMatchObject({ name: 'net', queued: 0, lastFrame: 0 });
    delivery.configure([info[1]], 2, send);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ session: 1, release: true }));
    delivery.prepare(vi.fn(), true);
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ session: 2, acknowledgedSequence: undefined });
    delivery.dispose();
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ session: 2, release: true });
  });
  it('creates a consumer identity when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const delivery = new ScriptStreamDelivery();
      const send = vi.fn();
      delivery.configure(info, 1, send);
      delivery.refreshStatus();
      expect(send.mock.calls[0][0].consumer).toEqual(expect.any(String));
      expect(send.mock.calls[0][0].consumer.length).toBeGreaterThan(0);
      delivery.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('ignores status for other sessions/consumers, future requests and invalid queue counts', () => {
    const delivery = new ScriptStreamDelivery();
    const send = vi.fn();
    delivery.configure(info, 1, send);
    delivery.refreshStatus();
    const request = send.mock.calls[0][0];
    const valid = { session: 1, consumer: request.consumer, request: request.request, streams: [{ name: 'net', queued: 7 }] };
    delivery.receiveStatus({ ...valid, session: 2 });
    delivery.receiveStatus({ ...valid, consumer: 'someone-else' });
    delivery.receiveStatus({ ...valid, request: request.request + 1 });
    expect(delivery.status()[0].queued).toBe(0);
    delivery.receiveStatus(valid);
    expect(delivery.status()[0].queued).toBe(7);
    expect(delivery.status()[1].queued).toBe(0);
    for (const queued of [-1, 0.5, NaN, Infinity, 9]) {
      delivery.refreshStatus();
      delivery.receiveStatus({ ...valid, request: send.mock.calls.at(-1)![0].request, streams: [{ name: 'net', queued }] });
      expect(delivery.status()[0].queued).toBe(7);
    }
    delivery.refreshStatus();
    delivery.receiveStatus({ ...valid, request: send.mock.calls.at(-1)![0].request, streams: [{ name: 'net', queued: 0 }, { name: 'uart', queued: 8 }] });
    expect(delivery.status().map(stream => stream.queued)).toEqual([0, 8]);
    delivery.dispose();
  });
  it('rejects duplicate or unknown streams and every invalid uint32 branch without ending the request', () => {
    const delivery = new ScriptStreamDelivery();
    const send = vi.fn();
    delivery.configure(info, 1, send);
    delivery.prepare(vi.fn(), true);
    const request = send.mock.calls[0][0].request;
    const net = { name: 'net', data: [1], queued: 1 };
    const uart = { name: 'uart', data: [2], queued: 1 };
    const frame = { session: 1, sequence: 1, streams: [net, uart] };
    expect(delivery.receive({ ...frame, sequence: 0 }, request)).toBe(false);
    expect(delivery.receive({ ...frame, streams: [net, net] }, request)).toBe(false);
    expect(delivery.receive({ ...frame, streams: [net, { ...uart, name: 'unknown' }] }, request)).toBe(false);
    for (const word of [0.5, -1, 4294967296, NaN, Infinity]) {
      expect(delivery.receive({ ...frame, streams: [{ ...net, data: [word] }, uart] }, request)).toBe(false);
    }
    expect(delivery.receive({ ...frame, streams: [{ ...net, data: [4294967295] }, uart] }, request)).toBe(true);
    expect(delivery.receive(frame, request)).toBe(false);
    delivery.submitted(true);
    expect(delivery.receive(frame, send.mock.calls.at(-1)![0].request)).toBe(false);
    expect(delivery.status().map(stream => stream.queued)).toEqual([0, 0]);
    delivery.dispose();
  });
  it('resets pending frames and queue counters before requesting new data', () => {
    const delivery = new ScriptStreamDelivery();
    const send = vi.fn();
    const write = vi.fn();
    delivery.configure([info[0]], 3, send);
    delivery.prepare(write, true);
    const oldRequest = send.mock.calls[0][0].request;
    const frame = { session: 3, sequence: 1, streams: [{ name: 'net', data: [4, 5], queued: 1 }] };
    expect(delivery.receive(frame, oldRequest)).toBe(true);
    delivery.submitted(true);
    expect(delivery.status()[0]).toMatchObject({ queued: 0, lastFrame: 2 });
    delivery.reset();
    expect(delivery.status()[0]).toMatchObject({ queued: 0, lastFrame: 0 });
    delivery.prepare(write, true);
    expect([...write.mock.calls.at(-1)![1]]).toEqual([0]);
    expect(delivery.receive(frame, oldRequest)).toBe(false);
    expect(delivery.receive(frame, send.mock.calls.at(-1)![0].request)).toBe(true);
    delivery.dispose();
  });
});

describe('stream graph validation boundaries', () => {
  const makeGraph = () => buildSlangPassGraph({ imageCode: '', config: null, buffers: {}, canvasWidth: 1, canvasHeight: 1 });
  it.each([
    { name: '1invalid', maxPerFrame: 2 },
    { name: 'a-b', maxPerFrame: 2 },
    { name: '', maxPerFrame: 2 },
    { name: 'net', maxPerFrame: 0.5 },
    { name: 'net', maxPerFrame: 65537 },
    { name: 'net', maxPerFrame: NaN },
  ])('rejects invalid metadata %#', stream => {
    const graph = makeGraph();
    addScriptStreams(graph, [{ ...stream, maxQueued: 65536 }]);
    expect(graph.storage).toEqual([]);
    expect(graph.errors).toEqual([`Invalid script stream: ${stream.name}`]);
  });
  it('assigns contiguous bindings to valid names and continues after conflicts/errors', () => {
    const graph = makeGraph();
    graph.storage.push({ name: 'existing', binding: 0, count: 1, stride: 4, elementType: 'uint', builtin: true });
    graph.passes[0].channels.push({ kind: 'keyboard', key: 'channel', slot: 0 });
    addScriptStreams(graph, [
      { name: 'existing', maxPerFrame: 1, maxQueued: 8 },
      { name: 'channel', maxPerFrame: 1, maxQueued: 8 },
      { name: 'uniform', maxPerFrame: 1, maxQueued: 8 },
      { name: 'bad-name', maxPerFrame: 1, maxQueued: 8 },
      { name: '_min0', maxPerFrame: 1, maxQueued: 8 },
      { name: '_min0', maxPerFrame: 1, maxQueued: 8 },
      { name: 'Max', maxPerFrame: 65536, maxQueued: 65536 },
    ], [{ name: 'uniform' }]);
    expect(graph.errors).toHaveLength(5);
    expect(graph.storage.map(stream => [stream.name, stream.binding, stream.count])).toEqual([
      ['existing', 0, 1], ['_min0', 1, 2], ['Max', 2, 65537],
    ]);
  });
});


it.each(['render','compute'] as const)('binds WGSL %s streams with the same packed read-only length/data layout', kind => {
  const graph=buildSlangPassGraph({imageCode:'',config:null,buffers:{},canvasWidth:1,canvasHeight:1});
  addScriptStreams(graph,info);
  const code=buildWgslStorageDeclarations(graph.storage,2,kind).beforeCommon;
  expect(code).toContain('length: u32, data: array<u32, 2>');
  expect(code).toContain('@binding(5) var<storage, read> net:');
  expect(code).toContain('@binding(6) var<storage, read> uart:');
  expect(code).not.toContain('read_write');
  expect(buildWgslStorageDeclarations(graph.storage,0,kind,11).beforeCommon).toContain('@binding(11)');
});

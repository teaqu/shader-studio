import { describe, it, expect, vi } from 'vitest';
import { ScriptStreamClients } from '../../app/ScriptStreamClients.js';
describe('stream preview transport', () => {
  it('correlates leases, replaces sessions, and releases cursors on disconnect', () => {
    const provider = { requestScriptStreamFrame: vi.fn((session: number) => ({ session, sequence: 1, streams: [] })), releaseScriptStreamConsumer: vi.fn() };
    const clients = new ScriptStreamClients(provider);
    const owner = {};
    const respond = vi.fn();
    clients.handle({ session: 1, request: 1, consumer: 'a' }, respond, owner);
    expect(respond).toHaveBeenCalledWith({ type: 'scriptStreamFrame', payload: { request: 1, frame: { session: 1, sequence: 1, streams: [] } } });
    clients.handle({ session: 2, request: 2, consumer: 'a', acknowledgedSequence: 1 }, respond, owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledWith(1, 'a');
    clients.release(owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledWith(2, 'a');
    clients.release(owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed messages and releases only the owning cursor', () => {
    const provider = { requestScriptStreamFrame: vi.fn(() => ({ session: 1, sequence: 1, streams: [] })), releaseScriptStreamConsumer: vi.fn() };
    const clients = new ScriptStreamClients(provider);
    const owner = {};
    const respond = vi.fn();
    for (const payload of [null, {}, { session: 1, request: 1, consumer: '' }, { session: 1, request: 1, consumer: 'a', acknowledgedSequence: -1 }]) {
      clients.handle(payload, respond, owner);
    }
    expect(provider.requestScriptStreamFrame).not.toHaveBeenCalled();
    clients.handle({ session: 1, request: 1, consumer: 'a' }, respond, owner);
    clients.handle({ session: 1, request: 2, consumer: 'a', release: true }, respond, {});
    expect(provider.releaseScriptStreamConsumer).not.toHaveBeenCalled();
    clients.handle({ session: 1, request: 2, consumer: 'a', release: true }, respond, owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledWith(1, 'a');
  });
  it('ignores stale sessions and surfaces provider errors', () => {
    const provider = { requestScriptStreamFrame: vi.fn(() => null), releaseScriptStreamConsumer: vi.fn() };
    const clients = new ScriptStreamClients(provider);
    const respond = vi.fn();
    clients.handle({ session: 1, request: 1, consumer: 'a' }, respond, {});
    expect(respond).not.toHaveBeenCalled();
    provider.requestScriptStreamFrame.mockImplementation(() => {
      throw Error('limit');
    });
    clients.handle({ session: 1, request: 1, consumer: 'a' }, respond, {});
    expect(respond).toHaveBeenCalledWith({ type: 'error', payload: ['Script streams: Error: limit'] });
  });
});

describe('stream queue monitoring',()=>{
  it('reports paused queue depth without requesting data',()=>{
    const provider={requestScriptStreamFrame:vi.fn(()=>null),releaseScriptStreamConsumer:vi.fn(),getScriptStreamQueues:vi.fn(()=>[{name:'net',queued:5}])};
    const clients=new ScriptStreamClients(provider);const respond=vi.fn();clients.handle({session:1,request:1,consumer:'a',status:true},respond,{});
    expect(provider.requestScriptStreamFrame).not.toHaveBeenCalled();expect(respond).toHaveBeenCalledWith({type:'scriptStreamStatus',payload:{session:1,request:1,consumer:'a',streams:[{name:'net',queued:5}]}});
  });
});

describe('stream transport validation boundaries', () => {
  it.each([
    {session:'1'}, {session:0}, {session:1.5}, {session:Infinity},
    {request:'1'}, {request:0}, {request:1.5}, {request:Infinity},
    {acknowledgedSequence:'1'}, {acknowledgedSequence:0}, {acknowledgedSequence:1.5}, {acknowledgedSequence:Infinity},
    {consumer:1}, {consumer:''}, {consumer:'a'.repeat(129)},
  ])('rejects invalid protocol field %#', override => {
    const provider = {requestScriptStreamFrame:vi.fn(),releaseScriptStreamConsumer:vi.fn()};
    const clients = new ScriptStreamClients(provider);
    clients.handle({session:1,request:1,consumer:'a',...override},vi.fn(),{});
    expect(provider.requestScriptStreamFrame).not.toHaveBeenCalled();
  });
  it('accepts a maximum-length identity and replaces the same owner consumer in the same session', () => {
    const provider={requestScriptStreamFrame:vi.fn(()=>({session:1,sequence:1,streams:[]})),releaseScriptStreamConsumer:vi.fn()};
    const clients=new ScriptStreamClients(provider);const owner={};const respond=vi.fn();
    clients.handle({session:1,request:1,consumer:'a'.repeat(128)},respond,owner);
    clients.handle({session:1,request:2,consumer:'a'.repeat(128)},respond,owner);
    expect(provider.releaseScriptStreamConsumer).not.toHaveBeenCalled();
    clients.handle({session:1,request:3,consumer:'b'},respond,owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledExactlyOnceWith(1,'a'.repeat(128));
    clients.handle({session:2,request:4,consumer:'b',release:true},respond,owner);
    clients.handle({session:1,request:4,consumer:'a',release:true},respond,owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledTimes(1);
    clients.release(owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenLastCalledWith(1,'b');
  });
  it('silently ignores status requests when the provider has no queue or stale session', () => {
    const provider={requestScriptStreamFrame:vi.fn(()=>null),releaseScriptStreamConsumer:vi.fn()};
    const clients=new ScriptStreamClients(provider);const respond=vi.fn();
    clients.handle({session:1,request:1,consumer:'a',status:true},respond,{});
    const queues={...provider,getScriptStreamQueues:vi.fn(()=>null)};
    new ScriptStreamClients(queues).handle({session:1,request:1,consumer:'a',status:true},respond,{});
    expect(respond).not.toHaveBeenCalled();
    expect(provider.requestScriptStreamFrame).not.toHaveBeenCalled();
  });
});

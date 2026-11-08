import { describe, it, expect, vi } from 'vitest';
import { BrowserScriptSession } from '../scripts/BrowserScriptSession';

function fixture(enabled = true, snapshot = false) {
  const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
  const send = vi.fn();
  const read = vi.fn(async () => 'export function streams(ctx) { return { keys: ctx.stream() }; }');
  const session = new BrowserScriptSession({ send, read, enabled, snapshot, createWorker: () => worker as unknown as Worker });
  const source = { type: 'shaderSource', path: '/test.slang', language: 'slang', code: '', config: { script: './keys.ts' } };
  const reply = (data: unknown) => (worker.onmessage as unknown as (event: { data: unknown }) => void)({ data });
  return { session, worker, send, read, source, reply };
}
describe('standalone script sessions', () => {
  it('loads workspace scripts and adds declarations before forwarding source', async () => {
    const f=fixture(); await f.session.receive(f.source);
    expect(f.read).toHaveBeenCalledWith('/keys.ts'); expect(f.send).not.toHaveBeenCalled();
    f.reply({type:'loaded', result:{declarations:'uniform float speed;', uniforms:[{name:'speed',type:'float'}],streams:[{name:'keys',maxPerFrame:64,maxQueued:256}],session:1}});
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({customUniformDeclarations:'uniform float speed;',scriptSession:1}));
    f.session.dispose(); f.reply({type:'disposed'}); expect(f.worker.terminate).toHaveBeenCalledOnce();
  });
  it('reports disabled and missing scripts without executing code', async () => {
    const f=fixture(false); await f.session.receive(f.source); expect(f.worker.postMessage).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({scriptBundleError:expect.stringContaining('Enable workspace scripts')}));
    f.read.mockResolvedValueOnce(null as unknown as string); f.session.setEnabled(true); await vi.waitFor(()=>expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({scriptBundleError:expect.stringContaining('not found')})));
    f.session.dispose();
  });
  it('routes frame requests only to its own worker and drops stale worker responses', async () => {
    const f=fixture(); await f.session.receive(f.source); f.reply({type:'loaded',result:{declarations:'',uniforms:[],streams:[],session:1}});
    expect(f.session.handle({type:'requestScriptStreamFrame',payload:{session:1,request:1,consumer:'a'}})).toBe(true);
    expect(f.worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'requestScriptStreamFrame'}));
    expect(f.session.handle({type:'other'})).toBe(false);
    f.session.dispose();const count=f.send.mock.calls.length; f.reply({type:'customUniformValues',payload:{values:[]}});expect(f.send).toHaveBeenCalledTimes(count);
  });
  it('reuses a script on source-only recompiles, terminates it when disabled or removed', async () => {
    const f=fixture(); await f.session.receive(f.source);f.reply({type:'loaded',result:{declarations:'',uniforms:[],session:1}});
    await f.session.receive({...f.source,code:'changed'});expect(f.worker.postMessage.mock.calls.filter(([m])=>m.type==='load')).toHaveLength(1);
    f.session.setEnabled(false);f.reply({type:'disposed'});expect(f.worker.terminate).toHaveBeenCalledOnce();
    await f.session.receive({...f.source,config:null});expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({config:null})); f.session.dispose();
  });
});

it('forwards ordinary messages and reports read, worker, and initialization failures', async () => {
  const f=fixture();await f.session.receive({type:'hello'});expect(f.send).toHaveBeenLastCalledWith({type:'hello'});
  f.read.mockRejectedValueOnce(Error('read failed'));await f.session.receive(f.source);expect(f.send.mock.lastCall?.[0].scriptBundleError).toContain('read failed');
  await f.session.receive(f.source);(f.worker.onerror as unknown as (e:{message:string})=>void)({message:'worker failed'});
  expect(f.send.mock.lastCall?.[0].scriptBundleError).toBe('worker failed');f.reply({type:'disposed'});
  await f.session.receive(f.source);f.reply({type:'loaded',result:{error:'compile failed'}});
  expect(f.send.mock.lastCall?.[0].scriptBundleError).toBe('compile failed');f.reply({type:'disposed'});f.session.dispose();
});
it('drops reads superseded by a shader switch or disposal', async () => {
  const f=fixture();let resolve!: (text:string)=>void;
  f.read.mockReturnValueOnce(new Promise<string>(done=>{
    resolve=done;
  }));
  const pending=f.session.receive(f.source);await f.session.receive({...f.source,config:null});resolve('old source');await pending;
  expect(f.worker.postMessage).not.toHaveBeenCalled();f.session.dispose();await f.session.receive(f.source);
  f.session.setEnabled(false);expect(f.worker.postMessage).not.toHaveBeenCalled();
});
it('times out stuck initialization and terminates unresponsive cleanup', async () => {
  vi.useFakeTimers();try {
    const f=fixture();await f.session.receive(f.source);vi.advanceTimersByTime(5000);
    expect(f.send.mock.lastCall?.[0].scriptBundleError).toContain('timed out');vi.advanceTimersByTime(250);
    expect(f.worker.terminate).toHaveBeenCalledOnce();f.session.dispose();expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('handles unavailable workers and forwards live values only while attached', async () => {
  const send=vi.fn();const session=new BrowserScriptSession({enabled:true,send,read:async()=>'',createWorker:()=>{
    throw Error('worker blocked');
  }});
  await session.receive({type:'shaderSource',path:'/a.slang',config:{script:'a.js'}});expect(send.mock.lastCall?.[0].scriptBundleError).toContain('worker blocked');session.dispose();
  const f=fixture();await f.session.receive(f.source);f.reply({type:'loaded',result:{declarations:'',uniforms:[],session:1}});f.reply({type:'customUniformValues',payload:{values:[]}});
  expect(f.send.mock.lastCall?.[0].type).toBe('customUniformValues');f.session.setEnabled(true);f.session.dispose();f.reply({type:'disposed'});
});
it('constructs the default module worker',async()=>{
  const f=fixture();const original=globalThis.Worker;
  try {
    vi.stubGlobal('Worker',class {
      constructor(){
        return f.worker;
      }
    });
    const session=new BrowserScriptSession({enabled:true,send:f.send,read:f.read});await session.receive(f.source);
    expect(f.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'load'}));session.dispose();f.reply({type:'disposed'});
  } finally {
    vi.stubGlobal('Worker',original);
  }
});

it('issues a new compile revision when scripts are enabled after a failed compile',async()=>{
  const f=fixture(false);await f.session.receive({...f.source,compileSequence:42});const before=f.send.mock.lastCall?.[0].compileSequence;
  f.session.setEnabled(true);await vi.waitFor(()=>expect(f.worker.postMessage).toHaveBeenCalled());
  f.reply({type:'loaded',result:{declarations:'',uniforms:[],streams:[],session:1}});
  expect(f.send.mock.lastCall?.[0].compileSequence).toBeGreaterThan(before);
  f.session.dispose();f.reply({type:'disposed'});
});


it('prepares snapshot values without starting polling', async () => {
  const f=fixture(true,true);await f.session.receive(f.source);
  const values=[{name:'speed',type:'float',value:0.75}];
  f.reply({type:'loaded',result:{declarations:'uniform float speed;',uniforms:[{name:'speed',type:'float'}],streams:[],session:1},values});
  expect(f.send).toHaveBeenCalledWith(expect.objectContaining({customUniformValues:values}));
  expect(f.worker.postMessage.mock.calls.some(([message])=>message.type==='start')).toBe(false);
  f.session.dispose();f.reply({type:'disposed'});
});


it.each(['slang','wgsl'])('enables script stream loading for %s', async language => {
  const f=fixture();await f.session.receive({...f.source,language,path:'/image.'+language});
  expect(f.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'load',allowStreams:true}));
  f.session.dispose();f.reply({type:'disposed'});
});

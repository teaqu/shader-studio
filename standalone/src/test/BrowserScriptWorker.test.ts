import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserScriptWorker } from '../scripts/BrowserScriptWorker';
import type { BrowserScriptMessage } from '../scripts/BrowserScriptSession';
const workers: BrowserScriptWorker[] = [];
afterEach(() => {
  for (const worker of workers.splice(0)) {
    worker.handle({type:'dispose'});
  } vi.useRealTimers();
});
function load(code: string, allowStreams = true) {
  const messages: BrowserScriptMessage[] = [];
  const worker = new BrowserScriptWorker(message => messages.push(message)); workers.push(worker);
  worker.handle({type:'load',code,path:'/input.ts',allowStreams});
  const result = messages[0].result as {error?:string;session:number;uniforms:{name:string;type:string}[]};
  const request = (payload: Record<string, unknown> = {}) => {
    worker.handle({type:'requestScriptStreamFrame',payload:{session:result.session,request:1,consumer:'viewer',...payload}});return messages.at(-1)?.payload as {frame:{sequence:number;streams:{data:number[]}[]}};
  };
  return {worker,messages,result,request};
}
describe('browser script worker',()=>{
  it('transpiles TypeScript and preserves uint32/array uniform types',()=>{
    const f=load('export function uniforms(ctx: any) { const word: number = 4294967295; return {word:ctx.uint(word),arr:ctx.intArray([-1,2])}; }');
    expect(f.result.error).toBeUndefined();f.worker.handle({type:'start',payload:{fps:30}});
    expect(f.messages.at(-1)).toMatchObject({type:'customUniformValues',payload:{values:[{name:'word',type:'uint',value:4294967295},{name:'arr',type:'int[2]',value:[-1,2]}]}});
    f.worker.handle({type:'requestCustomUniformValues'});expect(f.messages.at(-1)?.type).toBe('customUniformValues');
  });
  it('delivers ordered keyboard events including repeats and Unicode through a script stream',()=>{
    const f=load(`export function streams(ctx) { const events=ctx.stream({maxPerFrame:2,maxQueued:8});ctx.onKeyboard(e=>events.push([e.repeat?2:e.key.codePointAt(0)]));return {events}; }`);
    for(const event of [{key:'😀',repeat:false},{key:'a',repeat:true},{key:'x',repeat:false}]) {
      f.worker.handle({type:'scriptKeyboardInput',payload:event});
    }
    const first=f.request();expect(first.frame.streams[0].data).toEqual([0x1f600,2]);
    expect(f.request().frame).toEqual(first.frame);
    expect(f.request({acknowledgedSequence:first.frame.sequence}).frame.streams[0].data).toEqual([120]);
    f.worker.handle({type:'resetScriptTime'});expect(f.request().frame.streams[0].data).toEqual([]);
  });
  it('isolates consumers, validates requests, reports queues and releases cursors',()=>{
    const f=load(`export function streams(ctx) {const data=ctx.stream();data.push([7]);return {data};}`);
    const first=f.request();expect(first.frame.streams[0].data).toEqual([7]);
    expect(f.request({consumer:'other'}).frame.streams[0].data).toEqual([]);
    const count=f.messages.length;f.request({session:-1});expect(f.messages.length).toBe(count);
    f.request({acknowledgedSequence:-1});expect(f.messages.length).toBe(count);
    f.request({status:true});expect(f.messages.at(-1)).toMatchObject({type:'scriptStreamStatus',payload:{streams:[{name:'data',queued:1}]}});
    f.request({release:true});expect(f.messages.at(-1)?.type).toBe('scriptStreamStatus');
  });
  it('retains timer pushes while paused and cleans up callbacks and timers on reload',()=>{
    vi.useFakeTimers();const f=load(`export function streams(ctx) {const data=ctx.stream();setInterval(()=>data.push([3]),10);ctx.onKeyboard(()=>data.push([4]));return {data};}`);
    f.worker.handle({type:'scriptRuntimeState',payload:{paused:true}});vi.advanceTimersByTime(20);expect(f.request().frame.streams[0].data).toEqual([3,3]);
    f.worker.handle({type:'load',code:'export function uniforms(){return {x:1};}',allowStreams:true});
    f.worker.handle({type:'scriptKeyboardInput',payload:{key:'a'}});f.worker.handle({type:'start',payload:{fps:60}});
    f.worker.handle({type:'scriptRuntimeState',payload:{paused:false}});f.worker.handle({type:'updateScriptPollingRate',payload:{fps:120}});
    f.worker.handle({type:'dispose'});expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ['import fs from "node:fs"; export function uniforms(){return {x:fs.readFileSync("x")};}',true,'cannot import'],
    ['export function streams(ctx){return {x:ctx.stream()};}',false,'Slang'],
    ['export function uniforms(){throw Error("boom");}',true,'boom'],
    ['export function streams(ctx){ctx.onKeyboard(1);return {};}',true,'onKeyboard'],
    ['export function streams(){return Promise.resolve({});}',true,'synchronously'],
  ])('reports unsupported imports and script failures', (code,allow,error)=>{
    expect(load(code,allow).result.error).toContain(error);
  });
  it('contains errors thrown by keyboard callbacks',()=>{
    const f=load(`export function streams(ctx){ctx.onKeyboard(()=>{throw Error('key failure');});return {};}`);
    f.worker.handle({type:'scriptKeyboardInput',payload:{}});expect(f.messages.at(-1)).toMatchObject({type:'warning'});
  });
});

it('allows callback unsubscription and ignores unrelated messages',()=>{
  const f=load(`export function streams(ctx){const stop=ctx.onKeyboard(()=>{throw Error('removed');});stop();return {};}`);
  const count=f.messages.length;f.worker.handle({type:'scriptKeyboardInput',payload:{}});f.worker.handle({type:'unrelated'});expect(f.messages).toHaveLength(count);
});
it('bootstraps the actual worker entry point and acknowledges disposal',async()=>{
  const send=vi.fn();const scope={postMessage:send,onmessage:null as unknown};
  vi.stubGlobal('self',scope);
  try {
    await import('../scripts/script.worker');
    (scope.onmessage as (event:{data:unknown})=>void)({data:{type:'load',code:'export function uniforms(){return {x:1};}',allowStreams:true}});
    expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'loaded'}));
    (scope.onmessage as (event:{data:unknown})=>void)({data:{type:'dispose'}});
    expect(send).toHaveBeenLastCalledWith({type:'disposed'});
  } finally {
    vi.unstubAllGlobals();
  }
});


it('returns initial uniform values for explorer snapshots and disposes their callbacks', () => {
  const send=vi.fn();const cleaned=vi.fn();
  const worker=new BrowserScriptWorker(send,{cleaned});workers.push(worker);
  worker.handle({type:'load',path:'/snapshot.js',snapshot:true,allowStreams:true,code:'export function uniforms(ctx) { return {speed: 0.75}; } export function streams(ctx) {ctx.onDispose(cleaned);return {keys:ctx.stream()};}'});
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'loaded',values:[{name:'speed',type:'float',value:0.75}],result:expect.objectContaining({streams:[expect.objectContaining({name:'keys'})]})}));
  worker.handle({type:'dispose'});expect(cleaned).toHaveBeenCalledOnce();
});

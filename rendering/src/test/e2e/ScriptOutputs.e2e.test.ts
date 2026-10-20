import { describe, it, expect } from 'vitest';
import { RenderingEngine } from '../../webgl/RenderingEngine';
import { WebGPURenderingEngine } from '../../webgpu/WebGPURenderingEngine';
import scriptUrl from '../../../../ui/src/slang/slang-wasm.js?url';
import wasmUrl from '../../../../ui/src/slang/slang-wasm.wasm?url';
import type { ScriptStreamRequest } from '../../webgpu/ScriptStreamDelivery';
describe('script outputs on real GPUs', () => {
  it.each(['glsl', 'slang', 'wgsl'] as const)('preserves integer and array values through %s', async (language) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    document.body.append(canvas);
    const engine = language === 'glsl' ? new RenderingEngine() : language === 'wgsl' ? new WebGPURenderingEngine(undefined, 'wgsl') : new WebGPURenderingEngine({ scriptUrl, wasmUrl });
    try {
      engine.initialize(canvas, true);
      const declarations = 'uniform uint counter; uniform int mode; uniform float weights[3]; uniform uint ids[2];';
      const info = [{ name: 'counter', type: 'uint' }, { name: 'mode', type: 'int' }, { name: 'weights', type: 'float[3]' }, { name: 'ids', type: 'uint[2]' }];
      const condition = 'counter == 4294967295u && mode == -2 && weights[0] == 0.25 && weights[1] == 0.5 && weights[2] == 0.75 && ids[0] == 123u && ids[1] == 4294967295u';
      const source = language === 'wgsl' ? `fn mainImage(p: vec2f) -> vec4f { return select(vec4f(1,0,0,1), vec4f(0,1,0,1), ${condition}); }` : language === 'glsl' ? `void mainImage(out vec4 c,in vec2 p){c=(${condition})?vec4(0,1,0,1):vec4(1,0,0,1);}` : `float4 mainImage(float2 p){return (${condition})?float4(0,1,0,1):float4(1,0,0,1);}`;
      engine.updateCustomUniformValues([{ name: 'counter', type: 'uint', value: 4294967295 }, { name: 'mode', type: 'int', value: -2 }, { name: 'weights', type: 'float[3]', value: [.25, .5, .75] }, { name: 'ids', type: 'uint[2]', value: [123, 4294967295] }]);
      const result = await engine.compileShaderPipeline(source, null, `test.${language}`, {}, declarations, info);
      expect(result?.errors ?? []).toEqual([]);
      expect(result?.success).toBe(true);
      if (engine instanceof RenderingEngine) {
        engine.renderForCapture();
        expect(engine.readPixel(0, 0)).toMatchObject({ r: 0, g: 255, b: 0 });
      } else {
        engine.requestPixelRegion(1, 0, 0);
        engine.renderForCapture();
        let pixel: Uint8ClampedArray | undefined;
        await expect.poll(() => {
          pixel = engine.collectPixelRegionResults()[0]?.rgba;
          return pixel !== undefined;
        }).toBe(true);
        const offset = (30 * 60 + 30) * 4;
        expect(Array.from(pixel!.slice(offset, offset + 3))).toEqual([0, 255, 0]);
      }
    } finally {
      engine.dispose();
      canvas.remove();
    }
  });
  it.each(['slang', 'wgsl'] as const)('binds streams in %s compute and Image, delivers once, and preserves paused chunks', async language => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    document.body.append(canvas);
    const engine = language === 'wgsl' ? new WebGPURenderingEngine(undefined, 'wgsl') : new WebGPURenderingEngine({ scriptUrl, wasmUrl });
    const requests: ScriptStreamRequest[] = [];
    try {
      engine.initialize(canvas, true);
      engine.configureScriptStreams([{ name: 'net', maxPerFrame: 4, maxQueued: 16 }], 1, request => requests.push(request));
      const config = { version: '1.0', storage: { result: { elementType: 'uint', stride: 4, count: 3 } }, passes: { Image: {}, ComputeA: { type: 'compute' as const, path: `compute.${language}`, dispatch: { count: 1 } } } };
      const image = language === 'wgsl' ? 'fn mainImage(p: vec2f) -> vec4f { return vec4f(f32(net.length)/4.0,0,0,1); }' : 'float4 mainImage(float2 p){return float4(float(net.length)/4.0,0,0,1);}';
      const compute = language === 'wgsl'
        ? '@compute @workgroup_size(1) fn computeMain(@builtin(global_invocation_id) id: vec3u) {if(id.x != 0u){return;} result[0]+=net.length; if(net.length>0u){result[1]=net.data[0];result[2]=net.data[net.length-1u];}}'
        : '[shader("compute")] [numthreads(1,1,1)] void computeMain(uint3 id : SV_DispatchThreadID){if(id.x != 0) return; result[0]+=net.length; if(net.length>0){result[1]=net.data[0];result[2]=net.data[net.length-1];}}';
      const result = await engine.compileShaderPipeline(image, config, `streams.${language}`, {ComputeA:compute});
      expect(result?.errors ?? []).toEqual([]);
      expect(result?.success).toBe(true);
      engine.render(100);
      expect(requests.length).toBe(1);
      expect(engine.receiveScriptStreamFrame({ session: 1, sequence: 1, streams: [{ name: 'net', data: [123, 4294967295], queued: 2 }] }, requests[0].request)).toBe(true);
      engine.togglePause();
      engine.render(120);
      expect(requests.length).toBe(1);
      engine.togglePause();
      engine.render(140);
      expect(requests.length).toBe(2);
      expect(Array.from(new Uint32Array((await engine.readStorageBuffer('result', 0, 3)).data))).toEqual([2, 123, 4294967295]);
      engine.render(160);
      expect(new Uint32Array((await engine.readStorageBuffer('result', 0, 3)).data)[0]).toBe(2);
    } finally {
      engine.dispose();
      canvas.remove();
    }
  });
});

describe('real WebSocket source → script → preview transport → GPU', () => {
  it('delivers two streams in order across frames, preserves pause, rejects overflow and closes sources on reload', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; document.body.append(canvas);
    const engine = new WebGPURenderingEngine({ scriptUrl, wasmUrl });
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__script-preview`);
    let metadata: import('@shader-studio/types').ShaderSourceMessage | undefined;
    let metadataCount = 0; let sourceGeneration = 0; let sourcesClosed = 0; let framesReceived = 0;
    let failure: string | undefined;
    const values = new Map<string, number>();
    let lastFrame: import('@shader-studio/types').ScriptStreamFrame | undefined;
    let lastRequest = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'shaderSource') {
        metadata = message; metadataCount++;
      }
      if (message.type === 'sourceReady') {
        sourceGeneration = message.generation;
      }
      if (message.type === 'sourceClosed') {
        sourcesClosed = message.closed;
      }
      if (message.type === 'fixtureError' || message.type === 'error') {
        failure = message.error ?? JSON.stringify(message.payload);
      }
      if (message.type === 'scriptStreamStatus') {
        engine.receiveScriptStreamStatus(message.payload);
      }
      if (message.type === 'scriptStreamFrame') {
        lastFrame = message.payload.frame; lastRequest = message.payload.request;
        if (engine.receiveScriptStreamFrame(lastFrame!, lastRequest)) {
          framesReceived++;
        }
      }
      if (message.type === 'customUniformValues') {
        engine.updateCustomUniformValues(message.payload.values);
        for (const value of message.payload.values) {
          if (typeof value.value === 'number') {
            values.set(value.name, value.value);
          }
        }
      }
    };
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    const checkReady = async () => {
      await expect.poll(() => failure ?? (metadataCount > 0 && sourceGeneration > 0), { timeout: 10000 }).toBe(true);
    };
    const compile = async () => {
      const source = metadata!;
      engine.configureScriptStreams(source.scriptStreams!, source.scriptSession!, request => send({ type: 'requestScriptStreamFrame', payload: request }));
      const compiled = await engine.compileShaderPipeline(source.code, source.config, source.path, source.buffers, source.customUniformDeclarations, source.customUniformInfo);
      expect(compiled?.errors ?? [], JSON.stringify(compiled)).toEqual([]);
      expect(compiled?.success).toBe(true);
    };
    let time = 100;
    const frame = () => engine.render(time += 20);
    const read = async () => Array.from(new Uint32Array((await engine.readStorageBuffer('result', 0, 8)).data));
    const hash = (words: number[]) => words.reduce((value, word) => (Math.imul(value, 31) + word) >>> 0, 0);
    try {
      engine.initialize(canvas, true);
      await checkReady();
      await compile();
      engine.togglePause();
      send({ type: 'testPush', stream: 0, data: [1, 2, 3, 4, 5, 4294967295] });
      send({ type: 'testPush', stream: 1, data: [9, 10, 11] });
      // Only two words of capacity remain: this entire push must be rejected.
      send({ type: 'testPush', stream: 0, data: [90, 91, 92] });
      await expect.poll(() => failure ?? [values.get('accepted'), values.get('rejected')]).toEqual([2, 1]);
      engine.refreshScriptStreamStatus();
      await expect.poll(() => engine.getScriptStreamStatus().map(stream => stream.queued)).toEqual([6, 3]);
      frame();
      expect((await read()).slice(0, 4)).toEqual([0, 0, 0, 0]);
      expect(framesReceived).toBe(0);
      engine.togglePause(); frame();
      await expect.poll(() => framesReceived).toBe(1);
      const oldFrame = lastFrame!; const oldRequest = lastRequest;
      frame();
      expect(await read()).toEqual([4, hash([1, 2, 3, 4]), 2, hash([9, 10]), 4, 2, 4294967295, 50]);
      await expect.poll(() => framesReceived).toBe(2);
      frame();
      expect((await read()).slice(0, 6)).toEqual([6, hash([1, 2, 3, 4, 5, 4294967295]), 3, hash([9, 10, 11]), 2, 1]);
      await expect.poll(() => framesReceived).toBe(3);
      frame();
      expect((await read()).slice(0, 6)).toEqual([6, hash([1, 2, 3, 4, 5, 4294967295]), 3, hash([9, 10, 11]), 0, 0]);
      const receivedBeforeReload = (await read()).slice(0, 4);
      engine.togglePause();
      send({ type: 'testPush', stream: 0, data: [101, 102] });
      await expect.poll(() => values.get('accepted')).toBe(3);
      engine.refreshScriptStreamStatus();
      await expect.poll(() => engine.getScriptStreamStatus()[0].queued).toBe(2);
      const oldSession = metadata!.scriptSession;
      send({ type: 'testReload' });
      await expect.poll(() => metadataCount === 2 && sourceGeneration === 2 && sourcesClosed >= 1).toBe(true);
      expect(metadata!.scriptSession).not.toBe(oldSession);
      await compile();
      expect(engine.receiveScriptStreamFrame(oldFrame, oldRequest)).toBe(false);
      const receivedBeforeResume = framesReceived;
      engine.togglePause(); frame();
      await expect.poll(() => framesReceived).toBe(receivedBeforeResume + 1);
      frame();
      expect((await read()).slice(0, 4)).toEqual(receivedBeforeReload);
      expect(engine.getScriptStreamStatus().every(stream => stream.queued === 0)).toBe(true);
      expect(failure).toBeUndefined();
    } finally {
      engine.dispose(); socket.close(); canvas.remove();
    }
  });
});

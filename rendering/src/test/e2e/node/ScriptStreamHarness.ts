import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
type ScriptRuntime = typeof import('../../../../../extension/src/app/ScriptEvaluator') &
  typeof import('../../../../../extension/src/app/ScriptStreamClients') &
  typeof import('../../../../../extension/src/app/services/Logger');
function loadScriptRuntime(): ScriptRuntime {
  // Match the extension's CommonJS bundle without starting VS Code or writing a second build.
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const compiled = buildSync({
    stdin: { contents: `export { ScriptEvaluator } from './extension/src/app/ScriptEvaluator';
      export { ScriptStreamClients } from './extension/src/app/ScriptStreamClients';
      export { Logger } from './extension/src/app/services/Logger';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    alias: { '@shader-studio/types': `${root}/types/dist/index.js` },
  });
  const module = { exports: {} };
  const initialize = new Function('require', 'module', 'exports', compiled.outputFiles[0].text);
  initialize(createRequire(import.meta.url), module, module.exports);
  return module.exports as ScriptRuntime;
}

const image = `float4 mainImage(float2 p) {
  return float4(float(net.length) / 4.0, float(uart.length) / 2.0, 0, 1);
}`;
const compute = `void computeMain(uint3 id) {
  if (id.x != 0) return;
  for (uint i = 0; i < net.length; i++) { result[0]++; result[1] = result[1] * 31u + net.data[i]; }
  for (uint i = 0; i < uart.length; i++) { result[2]++; result[3] = result[3] * 31u + uart.data[i]; }
  result[4] = net.length; result[5] = uart.length;
  result[6] = constantWord; result[7] = uint(weights[1] * 100.0);
}`;

/** Node half of the browser test: real source socket → production evaluator → production preview protocol. */
export function scriptStreamHarness(): Plugin {
  let dispose = () => {};
  return {
    name: 'script-stream-integration-harness',
    configureServer(server) {
      if (!server.httpServer) {
        return;
      }
      const http = server.httpServer;
      const {ScriptEvaluator, ScriptStreamClients, Logger} = loadScriptRuntime();
      const sources = new WebSocketServer({ noServer: true });
      const previews = new WebSocketServer({ noServer: true });
      const runtimes = new Map<string, {
        preview: WebSocket; evaluator: InstanceType<typeof ScriptEvaluator>; clients: InstanceType<typeof ScriptStreamClients>;
        source?: WebSocket; generation: number; opened: number; closed: number;
      }>();
      // User-script logs are irrelevant to this fixture; lifecycle failures still fail the browser test.
      Logger.initialize({ warn() {}, info() {}, debug() {}, error() {} } as unknown as Parameters<typeof Logger.initialize>[0]);
      function send(ws: WebSocket, message: unknown) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
      sources.on('connection', (ws, request) => {
        const url = new URL(request.url!, 'http://localhost');
        const runtime = runtimes.get(url.searchParams.get('id')!);
        if (!runtime) {
          ws.close(); return;
        }
        runtime.source = ws;
        runtime.opened++;
        send(runtime.preview, { type: 'sourceReady', generation: Number(url.searchParams.get('generation')), opened: runtime.opened });
        ws.on('close', () => {
          runtime.closed++;
          send(runtime.preview, { type: 'sourceClosed', closed: runtime.closed });
        });
      });
      previews.on('connection', (preview, request) => {
        const id = randomUUID();
        const evaluator = new ScriptEvaluator();
        const clients = new ScriptStreamClients({
          requestScriptStreamFrame: (...args) => evaluator.requestStreamFrame(...args),
          releaseScriptStreamConsumer: (...args) => evaluator.releaseStreamConsumer(...args),
          getScriptStreamQueues: (...args) => evaluator.getStreamQueues(...args),
        });
        const runtime = { preview, evaluator, clients, generation: 0, opened: 0, closed: 0, source: undefined as WebSocket | undefined };
        runtimes.set(id, runtime);
        function load() {
          runtime.generation++;
          const address = `ws://${request.headers.host}/__script-source?id=${id}&generation=${runtime.generation}`;
          const bundle = `var accepted = 0, rejected = 0; var __shaderUniforms = {
            uniforms(ctx) { return { accepted: ctx.uint(accepted), rejected: ctx.uint(rejected), constantWord: ctx.uint(4294967295), weights: ctx.floatArray([0.25, 0.5, 0.75]) }; },
            streams(ctx) {
              const net = ctx.stream({ maxPerFrame: 4, maxQueued: 8 });
              const uart = ctx.stream({ maxPerFrame: 2, maxQueued: 8 });
              const SourceSocket = require('ws').WebSocket;
              const source = new SourceSocket(${JSON.stringify(address)});
              source.binaryType = 'arraybuffer';
              source.onmessage = ({ data }) => {
                const packet = new Uint32Array(data);
                if ((packet[0] === 0 ? net : uart).push(packet.subarray(1))) accepted++; else rejected++;
              };
              source.onerror = () => {};
              ctx.onDispose(() => source.close());
              return { net, uart };
            }
          };`;
          const loaded = evaluator.loadScript(bundle, fileURLToPath(new URL('../../../../../examples/script-streams/stream-demo.uniforms.js', import.meta.url)));
          if (loaded.error) {
            send(preview, { type: 'fixtureError', error: loaded.error }); return;
          }
          send(preview, {
            type: 'shaderSource', path: 'stream-integration.slang', code: image,
            config: { version: '1.0', storage: { result: { elementType: 'uint', stride: 4, count: 8 } }, passes: { Image: {}, ComputeA: { path: 'compute.slang', dispatch: { count: 1 } } } },
            buffers: { ComputeA: compute }, customUniformDeclarations: loaded.declarations,
            customUniformInfo: loaded.uniforms, scriptStreams: loaded.streams, scriptSession: loaded.session,
          });
          evaluator.startPolling(values => send(preview, { type: 'customUniformValues', payload: { values } }), 10);
        }
        preview.on('message', bytes => {
          const message = JSON.parse(bytes.toString()) as { type: string; payload?: unknown; stream?: number; data?: number[] };
          if (message.type === 'testPush') {
            if (runtime.source?.readyState !== WebSocket.OPEN) {
              send(preview, { type: 'fixtureError', error: 'Source is not connected' }); return;
            }
            runtime.source.send(new Uint32Array([message.stream ?? 0, ...message.data!]).buffer);
          } else if (message.type === 'testReload') {
            clients.release(preview);
            load();
          } else if (message.type === 'requestScriptStreamFrame') {
            clients.handle(message.payload, response => send(preview, response), preview);
          }
        });
        preview.on('close', () => {
          clients.release(preview);
          evaluator.dispose();
          runtimes.delete(id);
        });
        load();
      });
      const upgrade = (request: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
        const path = new URL(request.url!, 'http://localhost').pathname;
        const target = path === '/__script-source' ? sources : path === '/__script-preview' ? previews : undefined;
        target?.handleUpgrade(request, socket, head, ws => target.emit('connection', ws, request));
      };
      http.on('upgrade', upgrade);
      dispose = () => {
        http.off('upgrade', upgrade);
        for (const runtime of runtimes.values()) {
          runtime.evaluator.dispose();
        }
        for (const ws of [...previews.clients, ...sources.clients]) {
          ws.terminate();
        }
        runtimes.clear();
        previews.close(); sources.close();
      };
      http.once('close', dispose);
    },
    closeBundle() {
      dispose();
    },
  };
}

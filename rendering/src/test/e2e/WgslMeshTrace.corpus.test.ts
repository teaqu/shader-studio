import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureWgslProjectReference, captureWgslProjectTrace, type WgslProjectTraceSnapshot } from '../../trace/WgslProjectTraceCapture';
import type { RenderPassNode } from '../../types/PassGraph';
import { packShaderToyUniforms } from '../../webgpu/uniforms';

describe('WGSL mesh trace primitive selection', () => {
  let device: GPUDevice;
  beforeAll(async () => {
    const adapter = await navigator.gpu.requestAdapter(); device = await adapter!.requestDevice();
  });
  afterAll(() => device.destroy());

  for (const indexFormat of ['uint16', 'uint32'] as const) {
    for (const coplanar of [false, true]) {
      it(`records only the depth winner for overlapping ${indexFormat} ${coplanar ? "coplanar" : "depth"} mesh triangles`, async () => {
        const data = new Float32Array([
          -1, -1, 0.5, 0, 0, 1, .25, 0, 1, -1, 0.5, 0, 0, 1, .25, 0, 0, 1, 0.5, 0, 0, 1, .25, 1,
          -1, -1, 0, 0, 0, 1, .75, 0, 1, -1, 0, 0, 0, 1, .75, 0, 0, 1, 0, 0, 0, 1, .75, 1,
        ]);
        if (coplanar) {
          for (const index of [2, 10, 18]) {
            data[index] = 0;
          }
        }
        const indices = indexFormat === 'uint16' ? new Uint16Array([0, 1, 2, 3, 4, 5]) : new Uint32Array([0, 1, 2, 3, 4, 5]);
        const vertexBuffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vertexBuffer, 0, data); device.queue.writeBuffer(indexBuffer, 0, indices);
        const pass: RenderPassNode = { kind: 'render', name: 'mesh', source: 'fn mainImage(coord: vec2f) -> vec4f { let winner = coord.x; return vec4f(winner, 0., 0., 1.); }', channels: [], geometry: 'cube', width: 16, height: 16, language: 'wgsl', output: 'canvas', outputLayers: 1, dispatchCount: 1, dispatchOnce: false, workgroupSize: [1, 1, 1] };
        const identity = new Float32Array(64); [0, 5, 10, 15, 16, 21, 26, 31, 32, 37, 42, 47].forEach(index => {
          identity[index] = 1;
        });
        const snapshot: WgslProjectTraceSnapshot = { device, pass, storage: [], storageBuffers: new Map(), channelResources: [], uniformData: packShaderToyUniforms({ width: 16, height: 16, time: 0, frame: 0, channelCount: 0, timeDelta: 0, frameRate: 60, mouse: [0,0,0,0], channelTime: [], channelLoaded: [], sampleRate: 44100, date: [0,0,0,0], channelResolution: [], cameraPos: [0,0,0], cameraDir: [0,0,-1] }), commonCode: '', customUniformInfo: [], sourcePath: 'mesh.wgsl', mesh: { vertexBuffer, indexBuffer, indexFormat, indexCount: 6 }, meshUniformData: identity.buffer };
        const request = { passName: 'mesh', stage: 'fragment' as const, pixel: [8, 8] as [number, number], capacity: 64 };
        try {
          const [reference, trace] = await Promise.all([captureWgslProjectReference(snapshot, request), captureWgslProjectTrace(snapshot, request)]);
          expect(trace.events.length).toBeGreaterThan(0);
          const winners = trace.events.flatMap(event => event.values).filter(value => value.name === 'winner');
          expect(winners).toHaveLength(1);
          expect(winners[0].value).toBe(coplanar ? 4 : 12);
          expect(trace.color).toEqual(reference.color);
        } finally {
          vertexBuffer.destroy(); indexBuffer.destroy();
        }
      });
    }
  }
});

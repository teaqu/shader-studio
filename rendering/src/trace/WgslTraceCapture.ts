/// <reference types="@webgpu/types" />
import type { WgslTraceLaunch, WgslTraceRecording } from '@shader-studio/types';
import { validateWgslTraceLaunch } from '@shader-studio/types';
import { emitWgslTracePrelude, planWgslTrace } from '@shader-studio/debug/trace';
import { decodeWgslTrace } from '@shader-studio/debug/trace';
import { wrapWgslImageSource, WGSL_ENTRY_FRAGMENT, WGSL_ENTRY_VERTEX } from '../webgpu/WgslPrelude';
import { packShaderToyUniforms } from '../webgpu/uniforms';

/** Owns a fresh device and offscreen render: never touches the viewer engine. */
export async function captureWgslTrace(launch: WgslTraceLaunch, signal?: AbortSignal): Promise<WgslTraceRecording> {
  validateWgslTraceLaunch(launch);
  signal?.throwIfAborted();
  const plan = planWgslTrace(launch);
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU is unavailable. The WGSL trace PoC requires a WebGPU-capable VS Code webview.');
  }
  const device = await adapter.requestDevice();
  const abort = () => device.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  const buffers: GPUBuffer[] = [];
  let target: GPUTexture | undefined;
  let scopeOpen = false;
  try {
    signal?.throwIfAborted();
    const wrapped = wrapWgslImageSource(`${plan.source}\n${emitWgslTracePrelude(plan)}`, { customUniforms: launch.customUniforms });
    if (wrapped.requiredFeatures?.length) {
      throw new Error('The trace PoC does not support enable directives requiring optional GPU features.');
    }
    device.pushErrorScope('validation');
    scopeOpen = true;
    const module = device.createShaderModule({ code: wrapped.source });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter(message => message.type === 'error');
    if (errors.length) {
      await device.popErrorScope();
      scopeOpen = false;
      throw new Error(`WGSL trace compilation failed: ${errors.map(message => message.message).join('\n')}`);
    }
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: WGSL_ENTRY_VERTEX },
      fragment: { module, entryPoint: WGSL_ENTRY_FRAGMENT, targets: [{ format: 'rgba32float' }] },
      primitive: { topology: 'triangle-list' },
    });
    const makeBuffer = (size: number, usage: GPUBufferUsageFlags) => {
      const buffer = device.createBuffer({ size, usage });
      buffers.push(buffer);
      return buffer;
    };
    const uniforms = packShaderToyUniforms({ width: launch.width, height: launch.height,
      time: launch.time, frame: launch.frame, timeDelta: launch.uniforms?.timeDelta ?? 0, frameRate: launch.uniforms?.frameRate ?? 0,
      mouse: launch.uniforms?.mouse ?? [0, 0, 0, 0], date: launch.uniforms?.date ?? [0, 0, 0, 0],
      cameraPos: launch.uniforms?.cameraPos ?? [0, 0, 0], cameraDir: launch.uniforms?.cameraDir ?? [0, 0, 0],
      channelTime: [], channelLoaded: [], channelResolution: [], sampleRate: launch.uniforms?.sampleRate ?? 44100 }, launch.customUniforms, launch.customUniforms);
    const frameBuffer = makeBuffer(uniforms.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(frameBuffer, 0, uniforms);
    const selector = makeBuffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(selector, 0, new Float32Array([launch.pixel[0] + 0.5, launch.height - launch.pixel[1] - 0.5, 0, 0]));
    const traceSize = 16 + plan.capacity * plan.recordWords * 4;
    const trace = makeBuffer(traceSize, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const readback = makeBuffer(traceSize, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const colorReadback = makeBuffer(256, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const group0 = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: frameBuffer } }] });
    const group1 = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [
      { binding: 0, resource: { buffer: selector } }, { binding: 1, resource: { buffer: trace } },
    ] });
    target = device.createTexture({ size: [launch.width, launch.height], format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group0);
    pass.setBindGroup(1, group1);
    pass.draw(3);
    pass.end();
    encoder.copyBufferToBuffer(trace, 0, readback, 0, traceSize);
    encoder.copyTextureToBuffer({ texture: target, origin: [launch.pixel[0], launch.pixel[1]] },
      { buffer: colorReadback, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]);
    const validation = await device.popErrorScope();
    scopeOpen = false;
    if (validation) {
      throw new Error(`WGSL trace GPU validation failed: ${validation.message}`);
    }
    await Promise.all([readback.mapAsync(GPUMapMode.READ), colorReadback.mapAsync(GPUMapMode.READ)]);
    signal?.throwIfAborted();
    const data = readback.getMappedRange().slice(0);
    const color = Array.from(new Float32Array(colorReadback.getMappedRange().slice(0, 16)));
    readback.unmap();
    colorReadback.unmap();
    return { path: launch.path, source: launch.source, sites: plan.sites, ...decodeWgslTrace(plan, data), color };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (scopeOpen) {
      // Preserve the original compile/cancellation error if the device was lost.
      await device.popErrorScope().catch(() => undefined);
    }
    for (const buffer of buffers) {
      buffer.destroy();
    }
    target?.destroy();
    device.destroy();
  }
}

/// <reference types="@webgpu/types" />
import type { WgslTraceLaunch } from '@shader-studio/types';
import { packShaderToyUniforms } from '../../webgpu/uniforms';
import { wrapWgslImageSource, WGSL_ENTRY_FRAGMENT, WGSL_ENTRY_VERTEX } from '../../webgpu/WgslPrelude';

/** Independent, uninstrumented rgba32float reference. No trace planner/decoder. */
export async function renderWgslTraceReference(device: GPUDevice, launch: WgslTraceLaunch): Promise<number[]> {
  const module = device.createShaderModule({ code: wrapWgslImageSource(launch.source, { customUniforms: launch.customUniforms }).source });
  const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
  if (errors.length) {
    throw new Error(errors.map(message => message.message).join('\n'));
  }
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto', vertex: { module, entryPoint: WGSL_ENTRY_VERTEX },
    fragment: { module, entryPoint: WGSL_ENTRY_FRAGMENT, targets: [{ format: 'rgba32float' }] },
  });
  const uniforms = packShaderToyUniforms({ width: launch.width, height: launch.height,
    time: launch.time, frame: launch.frame, timeDelta: 0, frameRate: 0,
    mouse: [0, 0, 0, 0], date: [0, 0, 0, 0], cameraPos: [0, 0, 0], cameraDir: [0, 0, 0],
    channelTime: [], channelLoaded: [], channelResolution: [], sampleRate: 44100 }, launch.customUniforms, launch.customUniforms);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const target = device.createTexture({ size: [launch.width, launch.height], format: 'rgba32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  try {
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target, origin: launch.pixel },
      { buffer: readback, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    return Array.from(new Float32Array(readback.getMappedRange().slice(0, 16)));
  } finally {
    readback.destroy();
    target.destroy();
    uniformBuffer.destroy();
  }
}

/// <reference types="@webgpu/types" />
import type { WgslProjectTraceRequest, WgslTraceRecording } from '@shader-studio/types';
import type { WgslProjectTraceSnapshot } from './WgslProjectTraceCapture';
import { isMeshGeometry } from '../preview3d/MeshFragmentContext';
import { getSlangChannels, buildSlangBindingPlan } from '../webgpu/SlangBindingPlan';
import { slangChannelLayoutEntries, slangChannelResourceEntries } from '../webgpu/SlangBindingResources';
import { wrapWgslImageSource, WGSL_ENTRY_VERTEX } from '../webgpu/WgslPrelude';
import { allowNonUniformDerivatives } from '../webgpu/wgslDiagnostics';
import { emitWgslTracePrelude } from '@shader-studio/debug';
import { planWgslTraceProgram } from '@shader-studio/debug';
import { decodeWgslTrace } from '@shader-studio/debug';
import { cloneWgslTraceChannels, cloneWgslTraceStorage } from './WgslTraceSnapshotResources';

const U = globalThis.GPUBufferUsage ?? { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as typeof GPUBufferUsage;

/** Replays exactly one wrapped vertex invocation in compute, where trace storage is legal. */
export async function captureWgslVertexTraceReplay(snapshot: WgslProjectTraceSnapshot, request: WgslProjectTraceRequest, signal?: AbortSignal, reference = false): Promise<WgslTraceRecording> {
  const { device, pass } = snapshot;
  const { bindings, dataBinding, resultBinding, plan, traceGroup, code } = prepareVertexReplay(snapshot, request, reference);
  const owned: GPUBuffer[] = [];
  const ownedTextures: GPUTexture[] = [];
  const make = (size: number, usage: GPUBufferUsageFlags) => {
    const b = device.createBuffer({ size: Math.ceil(size / 4) * 4, usage }); owned.push(b); return b;
  };
  try {
    // Submit snapshots before the first await. Video, feedback and a compile
    // replacement can otherwise change the resources under this replay.
    const channelsSnapshot = cloneWgslTraceChannels(device, snapshot.channelResources, ownedTextures);
    const storageSnapshot = cloneWgslTraceStorage(device, snapshot.storage, snapshot.storageBuffers, owned);
    const {uniform, vertexData, result, resultReadback, traceSize, selector, trace, traceReadback, group0, traceLayout, layouts} = prepareVertexBuffers(snapshot, request, plan, bindings, dataBinding, resultBinding, traceGroup, make);
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo(); signal?.throwIfAborted(); const errors = info.messages.filter(m => m.type === 'error'); if (errors.length) {
      throw new Error(`WGSL vertex replay compilation failed: ${errors.map(m => m.message).join('\n')}`);
    }
    const pipeline = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: layouts }), compute: { module, entryPoint: '_ss_vertexTraceReplay' } });
    signal?.throwIfAborted();
    const entries = vertexReplayInputs(snapshot, bindings, channelsSnapshot, storageSnapshot, uniform, vertexData, result, dataBinding, resultBinding, make);
    const encoder = device.createCommandEncoder(); const compute = encoder.beginComputePass(); compute.setPipeline(pipeline); compute.setBindGroup(0, device.createBindGroup({ layout: group0, entries }));
    if (selector && trace && traceLayout) {
      compute.setBindGroup(traceGroup, device.createBindGroup({ layout: traceLayout, entries: [{ binding: 0, resource: { buffer: selector } }, { binding: 1, resource: { buffer: trace } }] }));
    }
    compute.dispatchWorkgroups(1); compute.end(); encoder.copyBufferToBuffer(result, 0, resultReadback, 0, 16); if (trace && traceReadback) {
      encoder.copyBufferToBuffer(trace, 0, traceReadback, 0, traceSize);
    }
    device.pushErrorScope('validation');
    device.queue.submit([encoder.finish()]);
    const validation = await device.popErrorScope();
    if (validation) {
      throw new Error(`WGSL vertex replay GPU validation failed: ${validation.message}`);
    }
    await Promise.all([resultReadback.mapAsync(GPUMapMode.READ), ...(traceReadback ? [traceReadback.mapAsync(GPUMapMode.READ)] : [])]); signal?.throwIfAborted();
    const color = Array.from(new Float32Array(resultReadback.getMappedRange().slice(0))); const decoded = plan && traceReadback ? decodeWgslTrace(plan, traceReadback.getMappedRange().slice(0)) : { events: [], overflow: false };
    resultReadback.unmap(); traceReadback?.unmap(); return { path: snapshot.vertexPath ?? snapshot.sourcePath, source: pass.vertexSrc ?? pass.source, sites: plan?.sites ?? [], ...decoded, color };
  } finally {
    owned.forEach(buffer => buffer.destroy()); ownedTextures.forEach(texture => texture.destroy());
  }
}

function prepareVertexBuffers(snapshot: WgslProjectTraceSnapshot, request: WgslProjectTraceRequest, plan: ReturnType<typeof planWgslTraceProgram> | undefined, bindings: ReturnType<typeof buildSlangBindingPlan>, dataBinding: number, resultBinding: number, traceGroup: number, make: (size: number, usage: GPUBufferUsageFlags) => GPUBuffer) {
  const {device, pass} = snapshot;
  const uniform = make(snapshot.uniformData.byteLength, U.UNIFORM | U.COPY_DST); device.queue.writeBuffer(uniform, 0, snapshot.uniformData);
  const vertexData = make(32, U.STORAGE | U.COPY_DST | U.COPY_SRC);
  const vertex = request.vertexIndex ?? 0;
  if (isMeshGeometry(pass.geometry)) {
    if (!snapshot.mesh) {
      throw new Error(`Pass '${pass.name}' has no frozen mesh vertex buffer.`);
    }
    const copy = device.createCommandEncoder(); copy.copyBufferToBuffer(snapshot.mesh.vertexBuffer, vertex * 32, vertexData, 0, 32); device.queue.submit([copy.finish()]);
  }
  const result = make(16, U.STORAGE | U.COPY_SRC);
  const resultReadback = make(16, U.MAP_READ | U.COPY_DST);
  const traceSize = plan ? 16 + plan.capacity * plan.recordWords * 4 : 0;
  const selector = plan ? make(16, U.UNIFORM | U.COPY_DST) : undefined;
  if (selector) {
    device.queue.writeBuffer(selector, 0, new Uint32Array([0, 0, 0, 0]));
  }
  const trace = plan ? make(traceSize, U.STORAGE | U.COPY_SRC) : undefined;
  const traceReadback = plan ? make(traceSize, U.MAP_READ | U.COPY_DST) : undefined;
  const group0 = device.createBindGroupLayout({ entries: layoutEntries(snapshot, bindings, dataBinding, resultBinding) });
  const traceLayout = plan ? device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] }) : undefined;
  const layouts: GPUBindGroupLayout[] = []; layouts[0] = group0; if (traceLayout) {
    layouts[traceGroup] = traceLayout; for (let i = 1; i < traceGroup; i++) {
      layouts[i] = device.createBindGroupLayout({ entries: [] });
    }
  }
  return {uniform, vertexData, result, resultReadback, traceSize, selector, trace, traceReadback, group0, traceLayout, layouts};
}

function prepareVertexReplay(snapshot: WgslProjectTraceSnapshot, request: WgslProjectTraceRequest, reference: boolean) {
  const {device, pass} = snapshot;
  if (pass.kind !== 'render') {
    throw new Error(`Pass '${pass.name}' has no vertex stage.`);
  }
  const channels = getSlangChannels(pass.channels);
  const bindings = buildSlangBindingPlan(channels);
  const wrapped = wrapWgslImageSource(pass.source, { passName: pass.name, commonCode: snapshot.commonCode, channels, storage: snapshot.storage, geometry: pass.geometry, vertexSpace: pass.space, vertexCode: pass.vertexSrc, customUniforms: snapshot.customUniformInfo as never[] });
  const features: Record<string, GPUFeatureName> = { f16: 'shader-f16', dual_source_blending: 'dual-source-blending', clip_distances: 'clip-distances', subgroups: 'subgroups' };
  const missing = wrapped.requiredFeatures.filter(feature => features[feature] !== undefined && !device.features.has(features[feature]));
  if (missing.length) {
    throw new Error(`Vertex trace requires unavailable optional WebGPU features: ${missing.join(', ')}.`);
  }
  const demoted = demoteVertexEntry(wrapped.source);
  const dataBinding = bindings.nextBinding + snapshot.storage.length + (pass.geometry === 'fullscreen' ? 0 : 1);
  const resultBinding = dataBinding + 1;
  const replay = `${demoted}\n@group(0) @binding(${dataBinding}) var<storage, read> _ss_trace_vertexData: array<f32>;\n@group(0) @binding(${resultBinding}) var<storage, read_write> _ss_trace_vertexResult: array<vec4f>;\n${vertexReplayEntry(pass.geometry === 'fullscreen', request.vertexIndex ?? 0, pass.geometry === 'vertices')}`;
  const ranges = [
    ...(snapshot.vertexPath && wrapped.vertexRange ? [{ path: snapshot.vertexPath, startLine: wrapped.vertexRange.startLine, endLine: wrapped.vertexRange.startLine + wrapped.vertexRange.lineCount - 1 }] : []),
    ...(snapshot.commonPath && wrapped.commonRange ? [{ path: snapshot.commonPath, startLine: wrapped.commonRange.startLine, endLine: wrapped.commonRange.startLine + wrapped.commonRange.lineCount - 1 }] : []),
  ];
  if (!ranges.length) {
    throw new Error(`Pass '${pass.name}' has no authored vertex hook to trace.`);
  }
  const plan = reference ? undefined : planWgslTraceProgram({ source: replay, entryPoint: '_ss_vertexTraceReplay', stage: 'compute', capacity: request.capacity, sourceRanges: ranges });
  const traceGroup = plan?.bindingGroup ?? 1;
  const code = allowNonUniformDerivatives(plan ? `${plan.source}\n${emitWgslTracePrelude(plan)}` : replay);
  return {bindings, dataBinding, resultBinding, plan, traceGroup, code};
}

function vertexReplayInputs(snapshot: WgslProjectTraceSnapshot, bindings: ReturnType<typeof buildSlangBindingPlan>, channelsSnapshot: WgslProjectTraceSnapshot['channelResources'], storageSnapshot: Map<string, GPUBuffer>, uniform: GPUBuffer, vertexData: GPUBuffer, result: GPUBuffer, dataBinding: number, resultBinding: number, make: (size: number, usage: GPUBufferUsageFlags) => GPUBuffer) {
  const {device, pass} = snapshot;
  const fallback = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const channelEntries = slangChannelResourceEntries(bindings, channelsSnapshot, fallback); if (!channelEntries) {
    throw new Error(`Pass '${pass.name}' lost a channel resource.`);
  }
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniform } }, ...channelEntries];
  for (const node of snapshot.storage) {
    entries.push({ binding: bindings.nextBinding + node.binding, resource: { buffer: storageSnapshot.get(node.name)! } });
  }
  if (pass.geometry !== 'fullscreen') {
    if (!snapshot.meshUniformData) {
      throw new Error(`Pass '${pass.name}' needs frozen mesh uniforms.`);
    } const mesh = make(snapshot.meshUniformData.byteLength, U.UNIFORM | U.COPY_DST); device.queue.writeBuffer(mesh, 0, snapshot.meshUniformData); entries.push({ binding: bindings.nextBinding + snapshot.storage.length, resource: { buffer: mesh } });
  }
  entries.push({ binding: dataBinding, resource: { buffer: vertexData } }, { binding: resultBinding, resource: { buffer: result } });
  return entries;
}

function demoteVertexEntry(source: string) {
  const start = source.indexOf(`@vertex fn ${WGSL_ENTRY_VERTEX}`); if (start < 0) {
    throw new Error('WGSL vertex entry was not generated.');
  } const end = source.indexOf('{', start); return `${source.slice(0, start)}${source.slice(start, end).replace('@vertex ', '').replace(/@(?:builtin|location)\([^)]*\)\s*/g, '')}${source.slice(end)}`;
}
export function vertexReplayEntry(fullscreen: boolean, vertexIndex: number, vertices = false) {
  if (vertices) {
    return `@compute @workgroup_size(1) fn _ss_vertexTraceReplay() { _ss_trace_vertexResult[0] = ${WGSL_ENTRY_VERTEX}(u32(${vertexIndex}),0u).position; }`; 
  }
  return fullscreen ? `@compute @workgroup_size(1) fn _ss_vertexTraceReplay() { _ss_trace_vertexResult[0] = ${WGSL_ENTRY_VERTEX}(u32(${vertexIndex})).position; }` : `@compute @workgroup_size(1) fn _ss_vertexTraceReplay() { var p=vec3f(_ss_trace_vertexData[0],_ss_trace_vertexData[1],_ss_trace_vertexData[2]); var n=vec3f(_ss_trace_vertexData[3],_ss_trace_vertexData[4],_ss_trace_vertexData[5]); var uv=vec2f(_ss_trace_vertexData[6],_ss_trace_vertexData[7]); _ss_trace_vertexResult[0] = ${WGSL_ENTRY_VERTEX}(p,n,uv,u32(${vertexIndex}),0u).position; }`;
}
function layoutEntries(snapshot: WgslProjectTraceSnapshot, plan: ReturnType<typeof buildSlangBindingPlan>, data: number, result: number): GPUBindGroupLayoutEntry[] {
  const entries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, ...slangChannelLayoutEntries(plan, GPUShaderStage.COMPUTE)]; for (const node of snapshot.storage) {
    entries.push({ binding: plan.nextBinding + node.binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: node.containsAtomic ? 'storage' : 'read-only-storage' } });
  } if (snapshot.pass.geometry !== 'fullscreen') {
    entries.push({ binding: plan.nextBinding + snapshot.storage.length, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } });
  } entries.push({ binding: data, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, { binding: result, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }); return entries.sort((a,b)=>a.binding-b.binding);
}

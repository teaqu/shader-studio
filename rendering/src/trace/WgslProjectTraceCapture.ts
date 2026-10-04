/// <reference types="@webgpu/types" />
import type { WgslProjectTraceRequest, WgslTraceRecording } from '@shader-studio/types';
import { isMeshGeometry } from '../preview3d/MeshFragmentContext';
import { depthClearValue, geometryInstanceCount, meshTopology, resolveRenderState, verticesTopology, verticesVertexCount } from '../types/Geometry';
import { webgpuBlendState } from '../webgpu/WebGPURenderState';
import { getSlangChannels } from '../webgpu/SlangBindingPlan';
import { buildSlangBindingPlan, validateSlangBindingBudget } from '../webgpu/SlangBindingPlan';
import { slangChannelLayoutEntries, slangChannelResourceEntries } from '../webgpu/SlangBindingResources';
import type { SlangChannelResource } from '../webgpu/SlangPassPipeline';
import { DISPATCH_UNIFORM_SIZE, SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from '../webgpu/SlangPrelude';
import { wrapWgslComputeSource, wrapWgslImageSource } from '../webgpu/WgslPrelude';
import { allowNonUniformDerivatives } from '../webgpu/wgslDiagnostics';
import type { RenderPassNode, StorageBindingNode } from '../types/PassGraph';
import { decodeWgslTrace, emitWgslTracePrelude, planWgslTraceProgram } from '@shader-studio/debug';
import { captureWgslVertexTraceReplay } from './WgslVertexTraceReplay';
import { patchWgslMeshPrimitiveTrace, prepareWgslMeshPrimitiveSelection } from './WgslMeshPrimitiveTrace';
import { cloneWgslTraceChannels, cloneWgslTraceStorage } from './WgslTraceSnapshotResources';

/** Frozen renderer state. The engine constructs this at a frame boundary. */
export interface WgslProjectTraceSnapshot {
  device: GPUDevice;
  pass: RenderPassNode;
  storage: StorageBindingNode[];
  storageBuffers: Map<string, GPUBuffer>;
  channelResources: SlangChannelResource[];
  /** Exact packed ShaderToy/custom-uniform block for this pass. */
  uniformData: ArrayBuffer;
  commonCode: string;
  customUniformInfo: Array<{ name: string; type: string }>;
  sourcePath: string;
  commonPath?: string;
  vertexPath?: string;
  mesh?: { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer; indexFormat: GPUIndexFormat; indexCount: number; vertexCount?: number; edgeIndexBuffer?: GPUBuffer; edgeIndexCount?: number };
  meshUniformData?: ArrayBuffer;
  dispatchWorkgroups?: [number, number, number];
  dispatchUniforms?: ArrayBuffer[];
  /** Canvas passes use the presentation format; callers can provide it to retain precision. */
  outputFormat?: GPUTextureFormat;
}

const U = globalThis.GPUBufferUsage ?? { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 } as typeof GPUBufferUsage;
const T = globalThis.GPUTextureUsage ?? { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 } as typeof GPUTextureUsage;

/**
 * Records one configured pass using the preview device but never its writable
 * resources. Storage and output bindings are trace-owned clones; sampled
 * channel views are immutable for this command buffer.
 */
export async function captureWgslProjectTrace(
  snapshot: WgslProjectTraceSnapshot,
  request: WgslProjectTraceRequest,
  signal?: AbortSignal,
  reference = false,
): Promise<WgslTraceRecording> {
  const { device, pass } = snapshot;
  signal?.throwIfAborted();
  const stage = request.stage ?? (pass.kind === 'compute' ? 'compute' : 'fragment');
  if (stage === 'vertex') {
    return captureWgslVertexTraceReplay(snapshot, request, signal, reference);
  }
  validateTraceSelection(pass, request, stage);
  const { computeEntry, wrapped, plan, bindings, traceGroup, traceSource } = prepareTraceProgram(snapshot, request, stage, reference);
  validateTraceFeatures(device, wrapped.requiredFeatures);
  const ownedBuffers: GPUBuffer[] = [];
  const ownedTextures: GPUTexture[] = [];
  const makeBuffer = (size: number, usage: GPUBufferUsageFlags) => {
    const buffer = device.createBuffer({ size: align4(size), usage }); ownedBuffers.push(buffer); return buffer;
  };
  try {
    const traceBytes = validateTraceBudget(snapshot, plan, bindings, stage);
    // This is deliberately before the first await below. A channel can be a
    // video frame or ping-pong target; retaining a GPUTextureView while a
    // pipeline compiles is not a snapshot.
    const channelResources = cloneWgslTraceChannels(device, snapshot.channelResources, ownedTextures);
    const uniform = makeBuffer(snapshot.uniformData.byteLength, U.UNIFORM | U.COPY_DST);
    device.queue.writeBuffer(uniform, 0, snapshot.uniformData);
    const storage = cloneWgslTraceStorage(device, snapshot.storage, snapshot.storageBuffers, ownedBuffers);
    const mesh = traceNeedsVertexBuffers(pass) ? cloneWgslTraceMesh(device, snapshot.mesh, ownedBuffers, pass) : undefined;
    const traceSize = traceBytes;
    const selector = plan ? makeBuffer(16, U.UNIFORM | U.COPY_DST | U.STORAGE) : undefined;
    if (selector) {
      writeSelector(device, selector, request, stage);
    }
    const trace = plan ? makeBuffer(traceSize, U.STORAGE | U.COPY_SRC) : undefined;
    const traceReadback = makeTraceReadback(plan, traceSize, makeBuffer);
    const group0Layout = device.createBindGroupLayout({ entries: group0LayoutEntries(pass, snapshot.storage, bindings, stage) });
    const {traceLayout, layouts} = prepareTraceLayouts(device, group0Layout, plan, traceGroup, stage);
    const {pipeline, output} = await prepareTracePipeline(snapshot, traceSource, layouts, computeEntry, stage, ownedTextures, signal);
    const {entries, dispatchBuffers} = prepareTraceInputs(snapshot, bindings, channelResources, uniform, storage, output, stage, makeBuffer);
    const meshSelection = mesh && selector && stage === 'fragment'
      ? await prepareWgslMeshPrimitiveSelection(device, allowNonUniformDerivatives(wrapped.source), mesh, group0Layout, meshVertexLayout(), pass.width, pass.height, ownedBuffers, ownedTextures, pass) : undefined;
    signal?.throwIfAborted();
    const traceGroupBind = selector && trace && traceLayout ? device.createBindGroup({ layout: traceLayout, entries: [{ binding: 0, resource: { buffer: selector } }, { binding: 1, resource: { buffer: trace } }] }) : undefined;
    const encoder = device.createCommandEncoder();
    const execution = { snapshot, request, signal, pipeline, group0Layout, entries, traceGroupBind, traceGroup, encoder, plan, trace, traceReadback, traceSize, makeBuffer, ownedTextures, storage, bindings, dispatchBuffers, output, mesh, meshSelection, selector };
    return await (stage === 'compute' ? executeComputeTrace(execution) : executeFragmentTrace(execution));
  } finally {
    for (const buffer of ownedBuffers) {
      buffer.destroy();
    }
    for (const texture of ownedTextures) {
      texture.destroy();
    }
  }
}

async function prepareTracePipeline(snapshot: WgslProjectTraceSnapshot, traceSource: string, layouts: GPUBindGroupLayout[], computeEntry: string, stage: string, ownedTextures: GPUTexture[], signal?: AbortSignal) {
  const {device, pass} = snapshot;
  const module = device.createShaderModule({ code: allowNonUniformDerivatives(traceSource) });
  const diagnostics = await module.getCompilationInfo(); signal?.throwIfAborted();
  const errors = diagnostics.messages.filter(message => message.type === 'error');
  if (errors.length) {
    throw new Error(`WGSL project trace compilation failed: ${errors.map(error => error.message).join('\n')}`);
  }
  const state = resolveRenderState(pass);
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: layouts });
  const output = stage === 'compute' && pass.output === 'texture'
    ? createComputeOutput(device, pass, ownedTextures)
    : undefined;
  const pipeline = stage === 'compute'
    ? await device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint: computeEntry } })
    : await device.createRenderPipelineAsync({ layout: pipelineLayout,
      vertex: { module, entryPoint: SLANG_ENTRY_VERTEX, ...(traceNeedsVertexBuffers(pass) ? { buffers: meshVertexLayout() } : {}) },
      // Trace colour is an independent diagnostic readback. Keep it f32 so
      // comparison is not affected by the canvas' presentation format.
      fragment: { module, entryPoint: SLANG_ENTRY_FRAGMENT, targets: [{ format: traceColorFormat(pass), ...webgpuBlendState(state.blend) }] },
      primitive: { topology: pass.geometry === 'vertices' ? verticesTopology(pass) : traceNeedsVertexBuffers(pass) ? meshTopology(pass) : 'triangle-list', frontFace: 'ccw', cullMode: state.cull },
      multisample: { count: state.samples },
      ...(state.depth ? { depthStencil: { format: 'depth24plus', depthWriteEnabled: state.depth.write, depthCompare: state.depth.test ? state.depth.compare : 'always' } } : {}),
    });
  signal?.throwIfAborted();
  return {pipeline, output};
}

function validateTraceSelection(pass: RenderPassNode, request: WgslProjectTraceRequest, stage: string) {
  if (stage === 'compute' && pass.kind !== 'compute') {
    throw new Error(`Pass '${pass.name}' is not a compute pass.`);
  }
  if (stage === 'fragment' && pass.kind !== 'render') {
    throw new Error(`Pass '${pass.name}' is not a render pass.`);
  }
  if (!Number.isInteger(request.pixel[0]) || !Number.isInteger(request.pixel[1])
    || request.pixel[0] < 0 || request.pixel[1] < 0 || request.pixel[0] >= pass.width || request.pixel[1] >= pass.height) {
    throw new Error(`Trace pixel must be inside pass '${pass.name}' (${pass.width}×${pass.height}).`);
  }
}

function validateTraceFeatures(device: GPUDevice, requiredFeatures: string[]) {
  const missingFeatures = requiredFeatures.filter(feature => {
    const known: Record<string, GPUFeatureName> = { f16: 'shader-f16', dual_source_blending: 'dual-source-blending', clip_distances: 'clip-distances', subgroups: 'subgroups' };
    return known[feature] !== undefined && !device.features.has(known[feature]);
  });
  if (missingFeatures.length) {
    throw new Error(`Trace requires unavailable optional WebGPU features: ${missingFeatures.join(', ')}.`);
  }
}

function validateTraceBudget(snapshot: WgslProjectTraceSnapshot, plan: ReturnType<typeof planWgslTraceProgram> | undefined, bindings: ReturnType<typeof buildSlangBindingPlan>, stage: string) {
  const {device, pass} = snapshot;
  const traceBytes = plan ? 16 + plan.capacity * plan.recordWords * 4 : 0;
  if (traceBytes > (device.limits.maxStorageBufferBindingSize ?? Infinity)) {
    throw new Error(`Trace recording requires ${traceBytes} bytes, exceeding this GPU's storage-buffer limit.`);
  }
  if (snapshot.uniformData.byteLength > (device.limits.maxUniformBufferBindingSize ?? Infinity)) {
    throw new Error(`Trace uniforms exceed this GPU's uniform-buffer limit.`);
  }
  for (const node of snapshot.storage) {
    if (node.count * node.stride > (device.limits.maxStorageBufferBindingSize ?? Infinity)) {
      throw new Error(`Storage '${node.name}' exceeds this GPU's storage-buffer limit.`);
    }
  }
  validateSlangBindingBudget(pass.name, bindings, device.limits, 2 + snapshot.storage.length + (isMesh(pass) ? 1 : 0) + (stage === 'compute' ? 2 : 0), snapshot.uniformData.byteLength);
  return traceBytes;
}

function prepareTraceLayouts(device: GPUDevice, group0Layout: GPUBindGroupLayout, plan: ReturnType<typeof planWgslTraceProgram> | undefined, traceGroup: number, stage: string) {
  const traceLayout = plan ? device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: traceVisibility(stage), buffer: { type: 'uniform' } },
    { binding: 1, visibility: traceVisibility(stage), buffer: { type: 'storage' } },
  ] }) : undefined;
  const layouts: GPUBindGroupLayout[] = [];
  for (const group of traceBindGroupIndexes(traceGroup, traceLayout !== undefined)) {
    layouts[group] = group === 0 ? group0Layout : group === traceGroup
      ? traceLayout! : device.createBindGroupLayout({ entries: [] });
  }
  return {traceLayout, layouts};
}

function prepareTraceInputs(snapshot: WgslProjectTraceSnapshot, bindings: ReturnType<typeof buildSlangBindingPlan>, channelResources: SlangChannelResource[], uniform: GPUBuffer, storage: Map<string, GPUBuffer>, output: ReturnType<typeof createComputeOutput> | undefined, stage: string, makeBuffer: TraceExecution['makeBuffer']) {
  const {device, pass} = snapshot;
  const fallbackSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniform } }];
  const channelEntries = slangChannelResourceEntries(bindings, channelResources, fallbackSampler);
  if (!channelEntries) {
    throw new Error(`Pass '${pass.name}' no longer has all channel resources required for tracing.`);
  }
  entries.push(...channelEntries);
  for (const node of snapshot.storage) {
    entries.push({ binding: bindings.nextBinding + node.binding, resource: { buffer: storage.get(node.name)! } });
  }
  if (isMesh(pass)) {
    if (!snapshot.meshUniformData) {
      throw new Error(`Pass '${pass.name}' needs a frozen mesh uniform snapshot.`);
    }
    const meshUniform = makeBuffer(snapshot.meshUniformData.byteLength, U.UNIFORM | U.COPY_DST);
    device.queue.writeBuffer(meshUniform, 0, snapshot.meshUniformData);
    entries.push({ binding: bindings.nextBinding + snapshot.storage.length, resource: { buffer: meshUniform } });
  }
  let dispatchBuffers: GPUBuffer[] = [];
  if (stage === 'compute') {
    if (output) {
      entries.push({ binding: bindings.nextBinding + snapshot.storage.length, resource: output.view });
    }
    const dispatchBinding = bindings.nextBinding + snapshot.storage.length + (output ? 1 : 0);
    dispatchBuffers = (snapshot.dispatchUniforms ?? [new ArrayBuffer(DISPATCH_UNIFORM_SIZE)]).map(data => {
      const buffer = makeBuffer(data.byteLength, U.UNIFORM | U.COPY_DST); device.queue.writeBuffer(buffer, 0, data); return buffer;
    });
    // Compute has one bind group per sub-dispatch; fill below.
    void dispatchBinding;
  }
  return {entries, dispatchBuffers};
}

async function submitTraceCommands(device: GPUDevice, encoder: GPUCommandEncoder) {
  device.pushErrorScope('validation');
  device.queue.submit([encoder.finish()]);
  const validation = await device.popErrorScope();
  if (validation) {
    throw new Error(`WGSL project trace GPU validation failed: ${validation.message}`);
  }
}

function prepareTraceProgram(snapshot: WgslProjectTraceSnapshot, request: WgslProjectTraceRequest, stage: 'compute' | 'fragment', reference: boolean) {
  const { pass } = snapshot;
  const computeEntry = pass.entryPoint ?? 'mainCompute';
  const channels = getSlangChannels(pass.channels);
  // Plan after production wrapping. It must see the real entry point and all
  // generated bindings, then add one fresh bind group beside them.
  const wrapped = stage === 'compute'
    ? wrapWgslComputeSource(pass.source, {
      passName: pass.name, commonCode: snapshot.commonCode, channels, storage: snapshot.storage,
      workgroupSize: pass.workgroupSize, outputLayers: pass.outputLayers, hasOutput: pass.output === 'texture',
      customUniforms: snapshot.customUniformInfo as never[],
      outputImageFormat: pass.resolvedOutputFormat === 'rgba32float' ? 'rgba32f' : 'rgba16f', entryPoint: computeEntry,
    })
    : wrapWgslImageSource(pass.source, {
      passName: pass.name, commonCode: snapshot.commonCode, channels, storage: snapshot.storage,
      geometry: pass.geometry, vertexSpace: pass.space, vertexCode: pass.vertexSrc, customUniforms: snapshot.customUniformInfo as never[],
    });
  const sourceEnd = wrapped.preludeLineCount + wrapped.userLineCount;
  const ranges = [
    { path: snapshot.sourcePath, startLine: wrapped.preludeLineCount + 1, endLine: sourceEnd },
    ...(snapshot.commonPath && wrapped.commonRange ? [{ path: snapshot.commonPath, startLine: wrapped.commonRange.startLine, endLine: wrapped.commonRange.startLine + wrapped.commonRange.lineCount - 1 }] : []),
  ];
  const plan = reference ? undefined : planWgslTraceProgram({
    source: stage === 'fragment' && traceNeedsVertexBuffers(pass) ? patchWgslMeshPrimitiveTrace(wrapped.source, meshTopology(pass), traceMeshPrimitiveCount(snapshot)) : wrapped.source,
    ...(stage === 'fragment' && traceNeedsVertexBuffers(pass) ? { fragmentPredicate: '_ss_trace_primitive == _ss_trace_u._pad.x' } : {}),
    entryPoint: stage === 'compute' ? computeEntry : SLANG_ENTRY_FRAGMENT,
    stage,
    capacity: request.capacity,
    sourceRanges: ranges,
  });
  const bindings = buildSlangBindingPlan(channels);
  const traceGroup = plan?.bindingGroup ?? 1;
  if (traceGroup === 0) {
    throw new Error('Trace instrumentation must use a bind group separate from pass resources.');
  }
  const traceSource = plan ? `${plan.source}\n${emitWgslTracePrelude(plan)}` : wrapped.source;
  return { computeEntry, wrapped, plan, bindings, traceGroup, traceSource };
}

interface TraceExecution {
  snapshot: WgslProjectTraceSnapshot;
  request: WgslProjectTraceRequest;
  signal?: AbortSignal;
  pipeline: GPUComputePipeline | GPURenderPipeline;
  group0Layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
  traceGroupBind?: GPUBindGroup;
  traceGroup: number;
  encoder: GPUCommandEncoder;
  plan?: ReturnType<typeof planWgslTraceProgram>;
  trace?: GPUBuffer;
  traceReadback?: GPUBuffer;
  traceSize: number;
  makeBuffer: (size: number, usage: GPUBufferUsageFlags) => GPUBuffer;
  ownedTextures: GPUTexture[];
  storage: Map<string, GPUBuffer>;
  bindings: ReturnType<typeof buildSlangBindingPlan>;
  dispatchBuffers: GPUBuffer[];
  output?: ReturnType<typeof createComputeOutput>;
  mesh?: ReturnType<typeof cloneWgslTraceMesh>;
  meshSelection?: Awaited<ReturnType<typeof prepareWgslMeshPrimitiveSelection>>;
  selector?: GPUBuffer;
}

async function executeComputeTrace(context: TraceExecution): Promise<WgslTraceRecording> {
  const { snapshot, request, signal, pipeline, group0Layout, entries, traceGroupBind, traceGroup, encoder, plan, trace, traceReadback, traceSize, makeBuffer, storage, bindings, dispatchBuffers, output } = context;
  const { device, pass } = snapshot;
  const outputBinding = bindings.nextBinding + snapshot.storage.length;
  const dispatchBinding = outputBinding + (output ? 1 : 0);
  const compute = encoder.beginComputePass(); compute.setPipeline(pipeline as GPUComputePipeline); if (traceGroupBind) {
    compute.setBindGroup(traceGroup, traceGroupBind);
  }
  for (const dispatchBuffer of dispatchBuffers) {
    const localEntries = [...entries, { binding: dispatchBinding, resource: { buffer: dispatchBuffer } }];
    const group = device.createBindGroup({ layout: group0Layout, entries: localEntries });
    compute.setBindGroup(0, group); compute.dispatchWorkgroups(...(snapshot.dispatchWorkgroups ?? [1, 1, 1]));
  }
  compute.end();
  const outputReadback = output ? makeBuffer(256, U.MAP_READ | U.COPY_DST) : undefined;
  const storageReadbacks = copyStorageForReadback(encoder, storage, snapshot.storage, makeBuffer);
  if (outputReadback && output) {
    encoder.copyTextureToBuffer({ texture: output.texture, origin: [request.pixel[0], request.pixel[1], 0] }, { buffer: outputReadback, bytesPerRow: 256 }, [1, 1, 1]);
  }
  if (trace && traceReadback) {
    encoder.copyBufferToBuffer(trace, 0, traceReadback, 0, traceSize);
  }
  await submitTraceCommands(device, encoder);
  await Promise.all([...(traceReadback ? [traceReadback.mapAsync(GPUMapMode.READ)] : []), ...(outputReadback ? [outputReadback.mapAsync(GPUMapMode.READ)] : []), ...storageReadbacks.map(item => item.readback.mapAsync(GPUMapMode.READ))]);
  signal?.throwIfAborted();
  const decoded = decodeTraceReadback(plan, traceReadback);
  const color = outputReadback && output ? decodeWgslProjectTracePixel(outputReadback.getMappedRange(), output.format) : [0, 0, 0, 0];
  const storageSnapshot = storageReadbacks.map(item => ({ name: item.name, bytes: Array.from(new Uint8Array(item.readback.getMappedRange().slice(0))) }));
  traceReadback?.unmap(); outputReadback?.unmap(); storageReadbacks.forEach(item => item.readback.unmap());
  return { path: snapshot.sourcePath, source: pass.source, sites: plan?.sites ?? [], ...decoded, color, storage: storageSnapshot };
}

async function executeFragmentTrace(context: TraceExecution): Promise<WgslTraceRecording> {
  const { snapshot, request, signal, pipeline, group0Layout, entries, traceGroupBind, traceGroup, encoder, plan, trace, traceReadback, traceSize, makeBuffer, ownedTextures, mesh, meshSelection, selector } = context;
  const { device, pass } = snapshot;
  const state = resolveRenderState(pass);
  const format = traceColorFormat(pass);
  const target = device.createTexture({ size: [pass.width, pass.height], format, usage: T.RENDER_ATTACHMENT | T.COPY_SRC }); ownedTextures.push(target);
  const multisampled = state.samples > 1 ? device.createTexture({ size: [pass.width, pass.height], format, sampleCount: state.samples, usage: T.RENDER_ATTACHMENT }) : undefined;
  if (multisampled) {
    ownedTextures.push(multisampled); 
  }
  const colorReadback = makeBuffer(256, U.MAP_READ | U.COPY_DST);
  const group = device.createBindGroup({ layout: group0Layout, entries });
  meshSelection?.encode(encoder, group, selector!, request.pixel);
  const depth = isMesh(pass) ? device.createTexture({ size: [pass.width, pass.height], format: 'depth24plus', sampleCount: state.samples, usage: T.RENDER_ATTACHMENT }) : undefined;
  if (depth) {
    ownedTextures.push(depth);
  }
  const render = encoder.beginRenderPass({ colorAttachments: [{ view: (multisampled ?? target).createView(), ...(multisampled ? { resolveTarget: target.createView() } : {}), loadOp: 'clear', storeOp: 'store', clearValue: state.clear }],
    ...(depth ? { depthStencilAttachment: { view: depth.createView(), depthClearValue: depthClearValue(state), depthLoadOp: 'clear' as const, depthStoreOp: 'store' as const } } : {}) });
  render.setPipeline(pipeline as GPURenderPipeline); render.setBindGroup(0, group); if (traceGroupBind) {
    render.setBindGroup(traceGroup, traceGroupBind);
  }
  if (traceNeedsVertexBuffers(pass)) {
    if (meshSelection) {
      render.setVertexBuffer(0, meshSelection.vertexBuffer); render.draw(mesh!.indexCount, geometryInstanceCount(pass));
    } else {
      render.setVertexBuffer(0, mesh!.vertexBuffer); render.setIndexBuffer(mesh!.indexBuffer, mesh!.indexFormat); render.drawIndexed(mesh!.indexCount, geometryInstanceCount(pass));
    }
  } else {
    render.draw(pass.geometry === 'vertices' ? verticesVertexCount(pass) : 3, geometryInstanceCount(pass));
  }
  render.end();
  encoder.copyTextureToBuffer({ texture: target, origin: [request.pixel[0], request.pixel[1]] }, { buffer: colorReadback, bytesPerRow: 256 }, [1, 1]);
  if (trace && traceReadback) {
    encoder.copyBufferToBuffer(trace, 0, traceReadback, 0, traceSize);
  }
  await submitTraceCommands(device, encoder);
  await Promise.all([...(traceReadback ? [traceReadback.mapAsync(GPUMapMode.READ)] : []), colorReadback.mapAsync(GPUMapMode.READ)]);
  signal?.throwIfAborted();
  const decoded = decodeTraceReadback(plan, traceReadback);
  const color = decodeWgslProjectTracePixel(colorReadback.getMappedRange(), format);
  traceReadback?.unmap(); colorReadback.unmap();
  return { path: snapshot.sourcePath, source: pass.source, sites: plan?.sites ?? [], ...decoded, color };
}

/** Render the same frozen project snapshot without instrumentation. */
export function captureWgslProjectReference(snapshot: WgslProjectTraceSnapshot, request: WgslProjectTraceRequest, signal?: AbortSignal): Promise<WgslTraceRecording> {
  return captureWgslProjectTrace(snapshot, request, signal, true);
}

function align4(value: number) {
  return Math.ceil(value / 4) * 4;
}
function isMesh(pass: RenderPassNode) {
  return pass.geometry !== 'fullscreen';
}
export function traceNeedsVertexBuffers(pass: Pick<RenderPassNode, 'geometry'>): boolean {
  return isMeshGeometry(pass.geometry);
}
function traceMeshPrimitiveCount(snapshot: WgslProjectTraceSnapshot): number {
  const mesh = snapshot.mesh;
  if (!mesh) {
    return 0; 
  }
  const topology = meshTopology(snapshot.pass);
  const count = topology === 'point-list' ? mesh.vertexCount ?? mesh.vertexBuffer.size / 32 : topology === 'line-list' ? mesh.edgeIndexCount ?? mesh.indexCount : mesh.indexCount;
  return Math.ceil(count / (topology === 'point-list' ? 1 : topology === 'line-list' ? 2 : 3));
}
function traceColorFormat(pass: RenderPassNode): GPUTextureFormat {
  const state = resolveRenderState(pass);
  return state.blend !== 'none' || state.samples > 1 ? 'rgba16float' : 'rgba32float';
}
function meshVertexLayout(): GPUVertexBufferLayout[] {
  return [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }] }];
}
function cloneWgslTraceMesh(device: GPUDevice, mesh: WgslProjectTraceSnapshot['mesh'], owned: GPUBuffer[], pass: RenderPassNode) {
  const passName = pass.name;
  if (!mesh) {
    throw new Error(`Pass '${passName}' needs frozen mesh buffers.`);
  }
  const vertexBuffer = device.createBuffer({ size: mesh.vertexBuffer.size, usage: U.VERTEX | U.STORAGE | U.COPY_DST });
  const topology = meshTopology(pass);
  const sourceIndices = topology === 'line-list' ? mesh.edgeIndexBuffer ?? mesh.indexBuffer : mesh.indexBuffer;
  const indexCount = topology === 'point-list' ? mesh.vertexCount ?? mesh.vertexBuffer.size / 32 : topology === 'line-list' ? mesh.edgeIndexCount ?? mesh.indexCount : mesh.indexCount;
  const indexFormat = topology === 'point-list' ? 'uint32' as const : mesh.indexFormat;
  const indexBuffer = device.createBuffer({ size: topology === 'point-list' ? Math.max(4, indexCount * 4) : sourceIndices.size, usage: U.INDEX | U.STORAGE | U.COPY_DST });
  owned.push(vertexBuffer, indexBuffer);
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(mesh.vertexBuffer, 0, vertexBuffer, 0, mesh.vertexBuffer.size);
  if (topology === 'point-list') {
    device.queue.writeBuffer(indexBuffer, 0, Uint32Array.from({ length: indexCount }, (_, index) => index));
  } else {
    encoder.copyBufferToBuffer(sourceIndices, 0, indexBuffer, 0, sourceIndices.size);
  }
  device.queue.submit([encoder.finish()]);
  return { ...mesh, vertexBuffer, indexBuffer, indexCount, indexFormat };
}
function writeSelector(device: GPUDevice, buffer: GPUBuffer, request: WgslProjectTraceRequest, stage: string) {
  const invocation = request.invocation ?? [request.pixel[0], request.pixel[1], 0];
  if (stage === 'fragment') {
    // Program planner gates against floor(@builtin(position)) in native
    // top-left WebGPU coordinates.
    device.queue.writeBuffer(buffer, 0, new Float32Array([request.pixel[0], request.pixel[1], 0, 0]));
    return;
  }
  // `_ss_trace_Uniforms` intentionally keeps xy as vec2f for fragment
  // matching; compute/vertex selectors use exact integer values in its pad.
  const data = new ArrayBuffer(16);
  new Float32Array(data).set(stage === 'vertex' ? [request.vertexIndex ?? 0, 0] : [invocation[0], invocation[1]], 0);
  new Uint32Array(data).set([invocation[2], request.vertexIndex ?? 0], 2);
  device.queue.writeBuffer(buffer, 0, data);
}
function group0LayoutEntries(pass: RenderPassNode, storage: StorageBindingNode[], plan: ReturnType<typeof buildSlangBindingPlan>, stage: string): GPUBindGroupLayoutEntry[] {
  const visibility = stage === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const channelVisibility = stage === 'compute' ? GPUShaderStage.COMPUTE
    : pass.vertexSrc ? GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT : GPUShaderStage.FRAGMENT;
  const entries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility, buffer: { type: 'uniform' } }, ...slangChannelLayoutEntries(plan, channelVisibility)];
  for (const node of storage) {
    entries.push({ binding: plan.nextBinding + node.binding, visibility, buffer: { type: stage === 'compute' || node.containsAtomic ? 'storage' : 'read-only-storage' } });
  }
  if (isMesh(pass)) {
    entries.push({ binding: plan.nextBinding + storage.length, visibility, buffer: { type: 'uniform' } });
  }
  if (stage === 'compute') {
    const output = plan.nextBinding + storage.length;
    if (pass.output === 'texture') {
      entries.push({ binding: output, visibility, storageTexture: { access: 'write-only', format: pass.resolvedOutputFormat ?? 'rgba16float', viewDimension: pass.outputLayers > 1 ? '2d-array' : '2d' } });
    }
    entries.push({ binding: output + (pass.output === 'texture' ? 1 : 0), visibility, buffer: { type: 'uniform' } });
  }
  return entries.sort((a, b) => a.binding - b.binding);
}
function traceVisibility(stage: string): GPUShaderStageFlags {
  return stage === 'compute' ? GPUShaderStage.COMPUTE : stage === 'vertex' ? GPUShaderStage.VERTEX : GPUShaderStage.FRAGMENT;
}
function createComputeOutput(device: GPUDevice, pass: RenderPassNode, owned: GPUTexture[]) {
  const format = pass.resolvedOutputFormat ?? 'rgba16float';
  const texture = device.createTexture({ size: { width: pass.width, height: pass.height, depthOrArrayLayers: pass.outputLayers }, format, usage: T.STORAGE_BINDING | T.COPY_SRC }); owned.push(texture);
  return { texture, format, view: texture.createView({ dimension: pass.outputLayers > 1 ? '2d-array' : '2d' }) };
}

function copyStorageForReadback(
  encoder: GPUCommandEncoder,
  storage: Map<string, GPUBuffer>,
  nodes: readonly StorageBindingNode[],
  makeBuffer: (size: number, usage: GPUBufferUsageFlags) => GPUBuffer,
) {
  return nodes.map(node => {
    const size = align4(node.count * node.stride);
    const readback = makeBuffer(size, U.MAP_READ | U.COPY_DST);
    encoder.copyBufferToBuffer(storage.get(node.name)!, 0, readback, 0, size);
    return { name: node.name, readback };
  });
}

export function decodeWgslProjectTracePixel(data: ArrayBuffer, format: GPUTextureFormat): number[] {
  if (format === 'rgba32float') {
    return Array.from(new Float32Array(data.slice(0, 16)));
  }
  if (format === 'rgba16float') {
    const half = new Uint16Array(data.slice(0, 8));
    return Array.from(half, value => float16(value));
  }
  throw new Error(`Project trace cannot decode compute output format '${format}'.`);
}

/** Group zero alone is intentional for a reference pipeline. */
export function traceBindGroupIndexes(traceGroup: number, traced: boolean): number[] {
  return traced ? Array.from({ length: traceGroup + 1 }, (_, index) => index) : [0];
}

function float16(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) {
    return sign * fraction * 2 ** -24;
  }
  if (exponent === 31) {
    return fraction ? Number.NaN : sign * Infinity;
  }
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function decodeTraceReadback(plan: ReturnType<typeof planWgslTraceProgram> | undefined, readback?: GPUBuffer) {
  return readback && plan ? decodeWgslTrace(plan, readback.getMappedRange().slice(0)) : { events: [], overflow: false };
}

function makeTraceReadback(plan: ReturnType<typeof planWgslTraceProgram> | undefined, size: number, makeBuffer: TraceExecution['makeBuffer']) {
  return plan ? makeBuffer(size, U.MAP_READ | U.COPY_DST) : undefined;
}

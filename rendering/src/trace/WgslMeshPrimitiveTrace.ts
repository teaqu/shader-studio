/// <reference types="@webgpu/types" />
import type { MeshTopology } from "@shader-studio/types";
import type { RenderPassNode } from "../types/PassGraph";
import { depthClearValue, geometryInstanceCount, meshTopology, resolveRenderState } from "../types/Geometry";
/** Generated-entry edits used only by the isolated mesh fragment trace. */
export function patchWgslMeshPrimitiveTrace(source: string, topology: MeshTopology = "triangle-list", primitiveCount = 0) {
  const verticesPerPrimitive = topology === "point-list" ? 1 : topology === "line-list" ? 2 : 3;
  const structNeedle = 'struct _ss_MeshVertexOut {';
  const vertexNeedle = '@vertex fn vertexMain(';
  const fragmentNeedle = '@fragment fn fragmentMain(';
  if (!source.includes(structNeedle) || !source.includes(vertexNeedle) || !source.includes(fragmentNeedle)) {
    throw new Error('WGSL mesh trace could not locate generated mesh entry points.');
  }
  // Generated mesh outputs reserve locations 0–3 for UV, position, normal,
  // and the instance ID. Keep primitive selection separate from instance IDs.
  let patched = source.replace(structNeedle, `${structNeedle} @location(4) @interpolate(flat) _ss_trace_primitive: u32,`);
  const vertexStart = patched.indexOf(vertexNeedle);
  const vertexClose = parameterClose(patched, vertexStart);
  const existingVertexIndex = patched.slice(vertexStart, vertexClose).match(/@builtin\(vertex_index\)\s+([A-Za-z_]\w*)/);
  const vertexIndex = existingVertexIndex?.[1] ?? '_ss_trace_vertexIndex';
  const instanceIndex = patched.slice(vertexStart, vertexClose).match(/@builtin\(instance_index\)\s+([A-Za-z_]\w*)/)?.[1];
  const instanceOffset = instanceIndex && primitiveCount > 0 ? ` + ${instanceIndex} * ${primitiveCount}u` : '';
  patched = `${patched.slice(0, vertexClose)}${existingVertexIndex ? '' : ', @builtin(vertex_index) _ss_trace_vertexIndex: u32'}${patched.slice(vertexClose)}`;
  const vertexEnd = patched.indexOf('\n}\n\n@fragment fn fragmentMain', vertexStart);
  const outputReturn = patched.lastIndexOf('return output;', vertexEnd);
  if (outputReturn < vertexStart) {
    throw new Error('WGSL mesh trace could not locate the generated vertex return.');
  }
  patched = `${patched.slice(0, outputReturn)}output._ss_trace_primitive = ${vertexIndex} / ${verticesPerPrimitive}u + 1u${instanceOffset}; ${patched.slice(outputReturn)}`;
  const fragmentStart = patched.indexOf(fragmentNeedle);
  const fragmentClose = parameterClose(patched, fragmentStart);
  patched = `${patched.slice(0, fragmentClose)}, @location(4) @interpolate(flat) _ss_trace_primitive: u32${patched.slice(fragmentClose)}`;
  return patched;
}

/** Replaces only the generated mesh fragment result; mainImage still executes, including discard. */
export function patchWgslMeshPrimitiveIdPass(source: string, topology: MeshTopology = "triangle-list", primitiveCount = 0) {
  const patched = patchWgslMeshPrimitiveTrace(source, topology, primitiveCount);
  const fragmentStart = patched.indexOf('@fragment fn fragmentMain(');
  const bodyStart = patched.indexOf('{', fragmentStart);
  const bodyEnd = patched.indexOf('\n}', bodyStart);
  const body = patched.slice(bodyStart, bodyEnd);
  const replaced = body.replace(/return mainImage\(([^;]+)\);/, 'let _ss_trace_discard = mainImage($1);\n  return _ss_trace_primitive;');
  if (replaced === body) {
    throw new Error('WGSL mesh trace could not locate generated fragment output.');
  }
  return `${patched.slice(0, fragmentStart)}${patched.slice(fragmentStart, bodyStart).replace('-> @location(0) vec4<f32>', '-> @location(0) u32')}${replaced}${patched.slice(bodyEnd)}`;
}

/** Expands indexed 8-float mesh vertices into a non-indexed vertex buffer on GPU. */
export const WGSL_MESH_INDEX_EXPAND = `
@group(0) @binding(0) var<storage, read> _ss_trace_vertices: array<f32>;
@group(0) @binding(1) var<storage, read> _ss_trace_indices: array<u32>;
@group(0) @binding(2) var<storage, read_write> _ss_trace_expanded: array<f32>;
@group(0) @binding(3) var<uniform> _ss_trace_indexFormat: u32;

@compute @workgroup_size(64)
fn _ss_trace_expandIndices(@builtin(global_invocation_id) gid: vec3u) {
  let outputVertex = gid.x;
  if (outputVertex * 8u >= arrayLength(&_ss_trace_expanded)) { return; }
  let word = _ss_trace_indices[outputVertex / select(2u, 1u, _ss_trace_indexFormat == 1u)];
  var index = select(word & 0xffffu, (word >> 16u) & 0xffffu, _ss_trace_indexFormat == 0u && (outputVertex & 1u) == 1u);
  if (_ss_trace_indexFormat == 1u) { index = word; }
  for (var component = 0u; component < 8u; component++) {
    _ss_trace_expanded[outputVertex * 8u + component] = _ss_trace_vertices[index * 8u + component];
  }
}
`;

function parameterClose(source: string, start: number): number {
  const open = source.indexOf('(', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '(') {
      depth++;
    }
    if (source[index] === ')' && --depth === 0) {
      return index;
    }
  }
  throw new Error('Generated mesh entry has an incomplete parameter list.');
}

interface FrozenMesh {
  vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer; indexFormat: GPUIndexFormat; indexCount: number;
}

/** Selects the depth-winning primitive entirely on GPU before recording any events. */
export async function prepareWgslMeshPrimitiveSelection(
  device: GPUDevice, source: string, mesh: FrozenMesh, layout: GPUBindGroupLayout,
  vertexLayout: GPUVertexBufferLayout[], width: number, height: number,
  ownedBuffers: GPUBuffer[], ownedTextures: GPUTexture[], pass?: RenderPassNode,
) {
  const buffer = (size: number, usage: GPUBufferUsageFlags) => {
    const result = device.createBuffer({ size, usage }); ownedBuffers.push(result); return result;
  };
  const vertices = buffer(mesh.indexCount * 32, GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX);
  const format = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(format, 0, new Uint32Array([mesh.indexFormat === 'uint32' ? 1 : 0, 0, 0, 0]));
  const expansion = await device.createComputePipelineAsync({ layout: 'auto', compute: {
    module: device.createShaderModule({ code: WGSL_MESH_INDEX_EXPAND }), entryPoint: '_ss_trace_expandIndices',
  } });
  const group = device.createBindGroup({ layout: expansion.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: mesh.vertexBuffer } }, { binding: 1, resource: { buffer: mesh.indexBuffer } },
    { binding: 2, resource: { buffer: vertices } }, { binding: 3, resource: { buffer: format } },
  ] });
  const state = resolveRenderState(pass ?? { geometry: "cube" });
  const multisampled = state.samples > 1;
  const idSource = patchWgslMeshPrimitiveIdPass(source, pass ? meshTopology(pass) : "triangle-list", Math.ceil(mesh.indexCount / (pass && meshTopology(pass) === "point-list" ? 1 : pass && meshTopology(pass) === "line-list" ? 2 : 3)));
  const module = device.createShaderModule({ code: multisampled ? idSource.replace('-> @location(0) u32', '-> @location(0) vec4f').replace('return _ss_trace_primitive;', 'return vec4f(f32(_ss_trace_primitive & 255u), f32((_ss_trace_primitive >> 8u) & 255u), f32((_ss_trace_primitive >> 16u) & 255u), 255.) / 255.;') : idSource });
  const diagnostics = await module.getCompilationInfo();
  const errors = diagnostics.messages.filter(item => item.type === 'error');
  if (errors.length) {
    throw new Error(`Mesh primitive selection failed: ${errors.map(item => item.message).join('\n')}`);
  }
  const pipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vertexMain', buffers: vertexLayout },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: multisampled ? 'rgba8unorm' : 'r32uint' }] },
    primitive: { topology: pass ? meshTopology(pass) : 'triangle-list', frontFace: 'ccw', cullMode: state.cull },
    multisample: { count: state.samples },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: state.depth!.write, depthCompare: state.depth!.test ? state.depth!.compare : 'always' },
  });
  const primitive = device.createTexture({ size: [width, height], format: multisampled ? 'rgba8unorm' : 'r32uint', sampleCount: state.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT | (multisampled ? GPUTextureUsage.TEXTURE_BINDING : GPUTextureUsage.COPY_SRC) }); ownedTextures.push(primitive);
  const pick = multisampled ? await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: `@group(0) @binding(0) var ids: texture_multisampled_2d<f32>; @group(0) @binding(1) var<storage, read_write> selection: array<u32>; @group(0) @binding(2) var<uniform> pixel: vec2u;
@compute @workgroup_size(1) fn pick() { for (var sample = 0u; sample < textureNumSamples(ids); sample++) { let bytes = vec3u(round(textureLoad(ids, vec2i(pixel), sample).rgb * 255.)); let id = bytes.x | (bytes.y << 8u) | (bytes.z << 16u); if (id != 0u) { selection[2] = id; return; } } }` }), entryPoint: 'pick' } }) : undefined;
  const pixelBuffer = multisampled ? buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST) : undefined;
  const depth = device.createTexture({ size: [width, height], format: 'depth24plus', sampleCount: state.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT }); ownedTextures.push(depth);
  const selected = buffer(256, GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  return { vertexBuffer: vertices, encode(encoder: GPUCommandEncoder, inputs: GPUBindGroup, selector: GPUBuffer, pixel: [number, number]) {
    const compute = encoder.beginComputePass(); compute.setPipeline(expansion); compute.setBindGroup(0, group);
    compute.dispatchWorkgroups(Math.ceil(mesh.indexCount / 64)); compute.end();
    const render = encoder.beginRenderPass({
      colorAttachments: [{ view: primitive.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: depthClearValue(state) },
    });
    render.setPipeline(pipeline); render.setBindGroup(0, inputs); render.setVertexBuffer(0, vertices); render.draw(mesh.indexCount, geometryInstanceCount(pass ?? {})); render.end();
    if (pick && pixelBuffer) {
      device.queue.writeBuffer(pixelBuffer, 0, new Uint32Array(pixel));
      const sample = encoder.beginComputePass(); sample.setPipeline(pick); sample.setBindGroup(0, device.createBindGroup({ layout: pick.getBindGroupLayout(0), entries: [{ binding: 0, resource: primitive.createView() }, { binding: 1, resource: { buffer: selector } }, { binding: 2, resource: { buffer: pixelBuffer } }] })); sample.dispatchWorkgroups(1); sample.end();
    } else {
      encoder.copyTextureToBuffer({ texture: primitive, origin: pixel }, { buffer: selected, bytesPerRow: 256 }, [1, 1]);
      encoder.copyBufferToBuffer(selected, 0, selector, 8, 4);
    }
  } };
}

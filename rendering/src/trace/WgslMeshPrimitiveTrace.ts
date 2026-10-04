/// <reference types="@webgpu/types" />
/** Generated-entry edits used only by the isolated mesh fragment trace. */
export function patchWgslMeshPrimitiveTrace(source: string) {
  const structNeedle = 'struct _ss_MeshVertexOut {';
  const vertexNeedle = '@vertex fn vertexMain(';
  const fragmentNeedle = '@fragment fn fragmentMain(';
  if (!source.includes(structNeedle) || !source.includes(vertexNeedle) || !source.includes(fragmentNeedle)) {
    throw new Error('WGSL mesh trace could not locate generated mesh entry points.');
  }
  let patched = source.replace(structNeedle, `${structNeedle} @location(3) @interpolate(flat) _ss_trace_primitive: u32,`);
  const vertexStart = patched.indexOf(vertexNeedle);
  const vertexClose = parameterClose(patched, vertexStart);
  patched = `${patched.slice(0, vertexClose)}${patched.slice(vertexStart, vertexClose).includes('@builtin(vertex_index)') ? '' : ', @builtin(vertex_index) _ss_trace_vertexIndex: u32'}${patched.slice(vertexClose)}`;
  const vertexEnd = patched.indexOf('\n}\n\n@fragment fn fragmentMain', vertexStart);
  const outputReturn = patched.lastIndexOf('return output;', vertexEnd);
  if (outputReturn < vertexStart) {
    throw new Error('WGSL mesh trace could not locate the generated vertex return.');
  }
  patched = `${patched.slice(0, outputReturn)}output._ss_trace_primitive = _ss_trace_vertexIndex / 3u + 1u; ${patched.slice(outputReturn)}`;
  const fragmentStart = patched.indexOf(fragmentNeedle);
  const fragmentClose = parameterClose(patched, fragmentStart);
  patched = `${patched.slice(0, fragmentClose)}, @location(3) @interpolate(flat) _ss_trace_primitive: u32${patched.slice(fragmentClose)}`;
  return patched;
}

/** Replaces only the generated mesh fragment result; mainImage still executes, including discard. */
export function patchWgslMeshPrimitiveIdPass(source: string) {
  const patched = patchWgslMeshPrimitiveTrace(source);
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
  ownedBuffers: GPUBuffer[], ownedTextures: GPUTexture[],
) {
  const buffer = (size: number, usage: GPUBufferUsageFlags) => {
    const result = device.createBuffer({ size, usage }); ownedBuffers.push(result); return result;
  };
  const texture = (format: GPUTextureFormat, usage: GPUTextureUsageFlags) => {
    const result = device.createTexture({ size: [width, height], format, usage }); ownedTextures.push(result); return result;
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
  const module = device.createShaderModule({ code: patchWgslMeshPrimitiveIdPass(source) });
  const diagnostics = await module.getCompilationInfo();
  const errors = diagnostics.messages.filter(item => item.type === 'error');
  if (errors.length) {
    throw new Error(`Mesh primitive selection failed: ${errors.map(item => item.message).join('\n')}`);
  }
  const pipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vertexMain', buffers: vertexLayout },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'r32uint' }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const primitive = texture('r32uint', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
  const depth = texture('depth24plus', GPUTextureUsage.RENDER_ATTACHMENT);
  const selected = buffer(256, GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  return { vertexBuffer: vertices, encode(encoder: GPUCommandEncoder, inputs: GPUBindGroup, selector: GPUBuffer, pixel: [number, number]) {
    const compute = encoder.beginComputePass(); compute.setPipeline(expansion); compute.setBindGroup(0, group);
    compute.dispatchWorkgroups(Math.ceil(mesh.indexCount / 64)); compute.end();
    const render = encoder.beginRenderPass({
      colorAttachments: [{ view: primitive.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    });
    render.setPipeline(pipeline); render.setBindGroup(0, inputs); render.setVertexBuffer(0, vertices); render.draw(mesh.indexCount); render.end();
    encoder.copyTextureToBuffer({ texture: primitive, origin: pixel }, { buffer: selected, bytesPerRow: 256 }, [1, 1]);
    encoder.copyBufferToBuffer(selected, 0, selector, 8, 4);
  } };
}

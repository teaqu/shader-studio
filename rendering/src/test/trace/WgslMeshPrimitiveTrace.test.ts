import { describe, expect, it } from 'vitest';
import { patchWgslMeshPrimitiveIdPass, patchWgslMeshPrimitiveTrace, WGSL_MESH_INDEX_EXPAND } from '../../trace/WgslMeshPrimitiveTrace';
import { wrapWgslImageSource } from '../../webgpu/WgslPrelude';

const meshModule = `struct _ss_MeshVertexOut {
  @builtin(position) position: vec4<f32>,
}
@vertex fn vertexMain(@location(0) position: vec3<f32>) -> _ss_MeshVertexOut {
  var output: _ss_MeshVertexOut;
  return output;
}

@fragment fn fragmentMain(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return mainImage(uv);
}
`;

describe('WGSL mesh primitive trace patch', () => {
  it.each([['point-list', 1], ['line-list', 2], ['triangle-list', 3]] as const)('uses %s primitive sizes and distinct IDs for instances', (topology, size) => {
    const source = wrapWgslImageSource('fn mainImage(p: vec2f) -> vec4f { return vec4f(p, 0., 1.); }', { geometry: 'cube' }).source;
    const patched = patchWgslMeshPrimitiveTrace(source, topology, 12);
    expect(patched).toContain(`output._ss_trace_primitive = vid / ${size}u + 1u + iid * 12u;`);
    expect(patchWgslMeshPrimitiveIdPass(source, topology, 12)).toContain(`vid / ${size}u + 1u + iid * 12u;`);
  });
  it.each([patchWgslMeshPrimitiveTrace, patchWgslMeshPrimitiveIdPass])('keeps primitive and instance varyings distinct in the current mesh prelude', (patch) => {
    const source = wrapWgslImageSource('fn mainImage(p: vec2f) -> vec4f { return vec4f(p, 0., 1.); }', { geometry: 'cube' }).source;
    const patched = patch(source);
    const output = patched.slice(patched.indexOf('struct _ss_MeshVertexOut {'), patched.indexOf('}', patched.indexOf('struct _ss_MeshVertexOut {')));
    expect(output.match(/@location\(3\)/g)).toHaveLength(1);
    expect(output).toContain('@location(3) @interpolate(flat) instanceIndex: u32');
    expect(output).toContain('@location(4) @interpolate(flat) _ss_trace_primitive: u32');
    const fragment = patched.slice(patched.indexOf('@fragment fn fragmentMain('), patched.indexOf('->', patched.indexOf('@fragment fn fragmentMain(')));
    expect(fragment.match(/@location\(3\)/g)).toHaveLength(1);
    expect(fragment).toContain('@location(4) @interpolate(flat) _ss_trace_primitive: u32');
  });

  it('carries a flat primitive id from the generated vertex entry', () => {
    const patched = patchWgslMeshPrimitiveTrace(meshModule);
    expect(patched).toContain('@location(4) @interpolate(flat) _ss_trace_primitive: u32');
    expect(patched).toContain('@builtin(vertex_index) _ss_trace_vertexIndex: u32');
    expect(patched).toContain('output._ss_trace_primitive = _ss_trace_vertexIndex / 3u + 1u;');
  });

  it('keeps mainImage in the ID pass so discard remains visible', () => {
    const patched = patchWgslMeshPrimitiveIdPass(meshModule);
    expect(patched).toContain('-> @location(0) u32');
    expect(patched).toContain('let _ss_trace_discard = mainImage(uv);');
    expect(patched).toContain('return _ss_trace_primitive;');
  });

  it('uses packed u16 and u32 index paths in the GPU expansion shader', () => {
    expect(WGSL_MESH_INDEX_EXPAND).toContain('word & 0xffffu');
    expect(WGSL_MESH_INDEX_EXPAND).toContain('if (_ss_trace_indexFormat == 1u) { index = word; }');
    expect(WGSL_MESH_INDEX_EXPAND).toContain('arrayLength(&_ss_trace_expanded)');
  });

  it('finds the generated entry parameter close without touching nested attributes', () => {
    const source = meshModule.replace('@location(0) position: vec3<f32>', '@location(0) position: vec3<f32>, @builtin(vertex_index) id: u32');
    const patched = patchWgslMeshPrimitiveTrace(source);
    expect(patched).toContain('@builtin(vertex_index) id: u32');
    expect(patched).toContain('output._ss_trace_primitive = id / 3u + 1u;');
    expect(patched).not.toContain('_ss_trace_vertexIndex');
  });
});

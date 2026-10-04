import { describe, expect, it } from 'vitest';
import { patchWgslMeshPrimitiveIdPass, patchWgslMeshPrimitiveTrace, WGSL_MESH_INDEX_EXPAND } from '../../trace/WgslMeshPrimitiveTrace';

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
  it('carries a flat primitive id from the generated vertex entry', () => {
    const patched = patchWgslMeshPrimitiveTrace(meshModule);
    expect(patched).toContain('@location(3) @interpolate(flat) _ss_trace_primitive: u32');
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
    expect(patchWgslMeshPrimitiveTrace(source)).toContain('@builtin(vertex_index) id: u32');
  });
});

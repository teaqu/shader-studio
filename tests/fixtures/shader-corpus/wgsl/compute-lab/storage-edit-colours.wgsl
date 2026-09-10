// Storage inspector test for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/storage-edit-colours.slang (no compute
// pass — the buffer is edited by hand). Edit the four float4 values in the
// Storage panel: each element controls one quadrant (top-left, top-right,
// bottom-left, bottom-right).

fn mainImage(coord: vec2f) -> vec4f {
    let column = select(0u, 1u, coord.x >= iResolution.x * 0.5);
    let row = select(1u, 0u, coord.y >= iResolution.y * 0.5);
    return vec4f(colours[row * 2u + column].rgb, 1.0);
}

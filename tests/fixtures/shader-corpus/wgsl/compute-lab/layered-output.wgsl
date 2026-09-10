// Layered-output display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/layered-output.slang.
// The config selects the blurred second output layer.

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    return iChannel0Sample(uv);
}

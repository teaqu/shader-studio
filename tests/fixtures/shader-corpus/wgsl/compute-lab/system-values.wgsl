// Compute system-values display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/system-values.slang.

fn mainImage(coord: vec2f) -> vec4f {
    return iChannel0Sample(coord / iResolution.xy);
}
